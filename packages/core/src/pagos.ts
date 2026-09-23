import { assertPesos, interesProporcional, type Pesos } from './dinero.ts';
import { ErrorNegocio } from './errores.ts';
import { assertFecha, dias30E360, fechaCorte, periodoDeFecha, type FechaISO } from './fechas.ts';
import { analizarLibro, type Aplicacion, type Libro, type Movimiento, type MovimientoNuevo } from './libro.ts';
import { repartirCapital, repartirInteres, type Prestamo } from './socios.ts';

export interface PagoEntrada {
  fecha: FechaISO;
  monto: Pesos;
}

function validarFechaNueva(prestamo: Prestamo, libro: Libro, fecha: FechaISO, hoy: FechaISO): void {
  assertFecha(fecha);
  assertFecha(hoy);
  if (libro.periodoLiquidado !== null || (libro.saldo === 0 && libro.efectivos.length > 0)) {
    throw new ErrorNegocio('PRESTAMO_CANCELADO', 'El préstamo ya está cancelado');
  }
  if (fecha > hoy) throw new ErrorNegocio('FECHA_FUTURA', `La fecha ${fecha} es posterior a hoy (${hoy})`);
  if (fecha < prestamo.fechaDesembolso) {
    throw new ErrorNegocio('FECHA_ANTES_DE_DESEMBOLSO', `La fecha ${fecha} es anterior al desembolso ${prestamo.fechaDesembolso}`);
  }
  if (libro.ultimaFecha !== null && fecha < libro.ultimaFecha) {
    throw new ErrorNegocio(
      'FECHA_ANTERIOR_A_ULTIMO_PAGO',
      `La fecha ${fecha} es anterior al último pago registrado (${libro.ultimaFecha})`,
    );
  }
}

function aplicacionInteres(prestamo: Prestamo, periodo: number, monto: Pesos): Aplicacion {
  return { periodo, aInteres: monto, aCapital: 0, reparto: repartirInteres(monto, prestamo.socios) };
}

function aplicacionCapital(prestamo: Prestamo, libro: Libro, monto: Pesos): Aplicacion {
  return { periodo: null, aInteres: 0, aCapital: monto, reparto: repartirCapital(monto, prestamo.socios, libro.devueltoPorSocio) };
}

interface InteresPendiente {
  periodo: number;
  monto: Pesos;
  vencido: boolean;
}

/**
 * Interés pendiente de los períodos 1..k (k = período de `fecha`), del más
 * antiguo al más nuevo. El período k solo está vencido si `fecha` es su corte.
 */
function interesesPendientes(prestamo: Prestamo, libro: Libro, fecha: FechaISO): InteresPendiente[] {
  const k = periodoDeFecha(prestamo.fechaDesembolso, fecha);
  const kVencido = fechaCorte(prestamo.fechaDesembolso, k) === fecha;
  const pendientes: InteresPendiente[] = [];
  for (let j = 1; j <= k; j++) {
    const monto = libro.interesDelPeriodo(j) - libro.interesPagadoEn(j);
    if (monto > 0) pendientes.push({ periodo: j, monto, vencido: j < k || kVencido });
  }
  return pendientes;
}

/**
 * Imputa un pago (SPEC §5.3): interés vencido del más antiguo al más nuevo,
 * interés del mes en curso completo, y el resto a capital.
 */
export function aplicarPago(
  prestamo: Prestamo,
  movimientos: readonly Movimiento[],
  pago: PagoEntrada,
  hoy: FechaISO,
): MovimientoNuevo {
  const libro = analizarLibro(prestamo, movimientos);
  validarFechaNueva(prestamo, libro, pago.fecha, hoy);
  assertPesos(pago.monto, 'monto del pago');
  if (pago.monto <= 0) throw new ErrorNegocio('MONTO_INVALIDO', 'El monto del pago debe ser mayor que 0');

  const pendientes = interesesPendientes(prestamo, libro, pago.fecha);
  const vencido = pendientes.filter((p) => p.vencido).reduce((s, p) => s + p.monto, 0);
  if (pago.monto < vencido) {
    throw new ErrorNegocio(
      'PAGO_INSUFICIENTE',
      `El pago de ${pago.monto} no cubre el interés vencido de ${vencido}`,
    );
  }

  const aplicaciones: Aplicacion[] = [];
  let resto = pago.monto;
  for (const p of pendientes) {
    const monto = Math.min(resto, p.monto);
    if (monto === 0) break;
    aplicaciones.push(aplicacionInteres(prestamo, p.periodo, monto));
    resto -= monto;
  }
  if (resto > 0) {
    if (resto > libro.saldo) {
      throw new ErrorNegocio(
        'PAGO_EXCEDE_DEUDA',
        `El pago excede la deuda: sobran ${resto - libro.saldo} después de cubrir interés y capital`,
      );
    }
    aplicaciones.push(aplicacionCapital(prestamo, libro, resto));
  }

  return { tipo: 'pago', fecha: pago.fecha, monto: pago.monto, reversaDe: null, aplicaciones };
}

export interface CotizacionLiquidacion {
  fecha: FechaISO;
  periodo: number;
  /** Interés de períodos ya vencidos sin pagar. */
  interesVencido: Pesos;
  /** Interés del período en curso, prorrateado a `diasEnCurso` y descontando lo ya pagado. */
  interesEnCurso: Pesos;
  diasEnCurso: number;
  capital: Pesos;
  total: Pesos;
  aplicaciones: Aplicacion[];
}

/**
 * Cuánto cuesta cancelar todo en `fecha` (SPEC §5.4): interés vencido +
 * interés del período en curso prorrateado 30/360 hasta ese día + capital.
 */
export function cotizarLiquidacion(
  prestamo: Prestamo,
  movimientos: readonly Movimiento[],
  fecha: FechaISO,
  hoy: FechaISO,
): CotizacionLiquidacion {
  const libro = analizarLibro(prestamo, movimientos);
  validarFechaNueva(prestamo, libro, fecha, hoy);

  const k = periodoDeFecha(prestamo.fechaDesembolso, fecha);
  const aplicaciones: Aplicacion[] = [];
  let interesVencido = 0;
  let interesEnCurso = 0;
  let diasEnCurso = 0;

  for (const p of interesesPendientes(prestamo, libro, fecha)) {
    if (!p.vencido) continue;
    aplicaciones.push(aplicacionInteres(prestamo, p.periodo, p.monto));
    interesVencido += p.monto;
  }
  if (fechaCorte(prestamo.fechaDesembolso, k) !== fecha) {
    diasEnCurso = Math.min(30, dias30E360(fechaCorte(prestamo.fechaDesembolso, k - 1), fecha));
    const proporcional = interesProporcional(libro.saldoAlCorte(k - 1), prestamo.tasaMensualBp, diasEnCurso);
    interesEnCurso = Math.max(0, proporcional - libro.interesPagadoEn(k));
    if (interesEnCurso > 0) aplicaciones.push(aplicacionInteres(prestamo, k, interesEnCurso));
  }
  if (libro.saldo > 0) aplicaciones.push(aplicacionCapital(prestamo, libro, libro.saldo));

  const total = interesVencido + interesEnCurso + libro.saldo;
  if (total === 0) throw new ErrorNegocio('NADA_QUE_LIQUIDAR', 'El préstamo no tiene saldo ni interés pendiente');
  return { fecha, periodo: k, interesVencido, interesEnCurso, diasEnCurso, capital: libro.saldo, total, aplicaciones };
}

/**
 * Ejecuta la cancelación total. `montoCotizado` es el total que se le mostró
 * al usuario: si el cálculo cambió desde entonces, se rechaza.
 */
export function aplicarLiquidacion(
  prestamo: Prestamo,
  movimientos: readonly Movimiento[],
  fecha: FechaISO,
  hoy: FechaISO,
  montoCotizado: Pesos,
): MovimientoNuevo {
  const c = cotizarLiquidacion(prestamo, movimientos, fecha, hoy);
  if (c.total !== montoCotizado) {
    throw new ErrorNegocio(
      'COTIZACION_DESACTUALIZADA',
      `La liquidación cuesta ${c.total}, no ${montoCotizado}. Cotiza de nuevo.`,
    );
  }
  return { tipo: 'liquidacion', fecha, monto: c.total, reversaDe: null, aplicaciones: c.aplicaciones };
}

/**
 * Reverso espejo de un movimiento. Solo se puede reversar el último
 * movimiento efectivo (LIFO), así ningún pago posterior queda imputado sobre
 * uno que ya no existe.
 */
export function reversarPago(
  prestamo: Prestamo,
  movimientos: readonly Movimiento[],
  movimientoId: string,
  fecha: FechaISO,
): MovimientoNuevo {
  const libro = analizarLibro(prestamo, movimientos);
  assertFecha(fecha);
  const original = movimientos.find((m) => m.id === movimientoId);
  if (!original) throw new ErrorNegocio('MOVIMIENTO_NO_EXISTE', `No existe el movimiento ${movimientoId}`);
  if (original.tipo === 'reverso') throw new ErrorNegocio('REVERSO_INVALIDO', 'Un reverso no se puede reversar');
  if (!libro.efectivos.includes(original)) throw new ErrorNegocio('REVERSO_INVALIDO', 'El movimiento ya fue reversado');
  if (libro.efectivos[libro.efectivos.length - 1] !== original) {
    throw new ErrorNegocio('REVERSO_NO_ES_ULTIMO', 'Solo se puede reversar el último pago registrado');
  }
  if (fecha < original.fecha) throw new ErrorNegocio('FECHA_INVALIDA', 'El reverso no puede ser anterior al pago original');

  return {
    tipo: 'reverso',
    fecha,
    monto: -original.monto,
    reversaDe: original.id,
    aplicaciones: original.aplicaciones.map((a) => ({
      periodo: a.periodo,
      aInteres: -a.aInteres,
      aCapital: -a.aCapital,
      reparto: a.reparto.map((r) => ({ socioId: r.socioId, interes: -r.interes, capital: -r.capital })),
    })),
  };
}
