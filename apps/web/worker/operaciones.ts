// Las operaciones que mueven plata. Cada una: lee el libro, calcula con core y
// escribe el asiento completo en UN batch de D1, que es una transacción: si una
// sentencia falla, no queda nada escrito.
//
// D1 no tiene bloqueo de filas (FOR UPDATE). La protección contra dos
// operaciones simultáneas sobre el mismo préstamo es el consecutivo
// `pagos.numero`: ambas leen N movimientos y calculan el número N+1; la primera
// entra y la segunda choca (unique + trigger), se descarta entera, y se
// reintenta leyendo el libro ya actualizado.
import {
  aplicarLiquidacion,
  aplicarPago,
  cotizarLiquidacion,
  ErrorNegocio,
  estadoPrestamo,
  generarPlanDePagos,
  reversarPago,
  validarPrestamo,
  type EstadoFinanciero,
  type MovimientoNuevo,
  type Prestamo,
} from '@prestamos/core';
import { aCore, type PrestamoFila } from '../compartido/api.ts';
import * as entrada from './entrada.ts';
import { hoyBogota } from './hoy.ts';
import { ErrorHttp } from './http.ts';
import { cargarPrestamo } from './repo.ts';

const INTENTOS = 3;

function esConflictoDeSecuencia(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e);
  return m.includes('CONFLICTO_SECUENCIA') || m.includes('pagos.prestamo_id, pagos.numero');
}

/** Reintenta la operación completa (leer → calcular → escribir) si otra se le adelantó. */
async function serializado<T>(operacion: () => Promise<T>): Promise<T> {
  for (let intento = 1; ; intento++) {
    try {
      return await operacion();
    } catch (e) {
      if (!esConflictoDeSecuencia(e)) throw e;
      if (intento === INTENTOS) {
        throw new ErrorHttp(409, 'CONFLICTO', 'Se registraron otros movimientos al mismo tiempo. Vuelve a intentarlo.');
      }
    }
  }
}

function exigirActivo(fila: PrestamoFila): void {
  if (fila.estado === 'castigado') throw new ErrorHttp(422, 'PRESTAMO_CASTIGADO', 'El préstamo está castigado; no recibe pagos');
  if (fila.estado === 'pagado') throw new ErrorHttp(422, 'PRESTAMO_CANCELADO', 'El préstamo ya está cancelado');
}

interface DatosPago {
  medio: string | null;
  nota: string | null;
  soportePath: string | null;
}

function leerDatosPago(e: entrada.Objeto): DatosPago {
  return {
    medio: entrada.textoOpcional(e, 'medio', 100),
    nota: entrada.textoOpcional(e, 'nota'),
    soportePath: entrada.textoOpcional(e, 'soportePath', 300),
  };
}

/** Escribe el asiento (pago + aplicaciones + reparto + cierre) y sincroniza el estado del préstamo. */
async function escribirMovimiento(
  db: D1Database,
  fila: PrestamoFila,
  numero: number,
  m: MovimientoNuevo,
  datos: DatosPago,
  estado: EstadoFinanciero,
): Promise<{ pagoId: string; estadoPrestamo: PrestamoFila['estado'] }> {
  const pagoId = crypto.randomUUID();
  const sentencias = [
    db
      .prepare(
        `insert into pagos (id, prestamo_id, numero, tipo, fecha, monto, reversa_de, medio, nota, soporte_path)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(pagoId, fila.id, numero, m.tipo, m.fecha, m.monto, m.reversaDe, datos.medio, datos.nota, datos.soportePath),
  ];
  for (const a of m.aplicaciones) {
    const aplicacionId = crypto.randomUUID();
    sentencias.push(
      db.prepare('insert into aplicaciones (id, pago_id, periodo, a_interes, a_capital) values (?, ?, ?, ?, ?)').bind(aplicacionId, pagoId, a.periodo, a.aInteres, a.aCapital),
    );
    for (const r of a.reparto) {
      if (r.interes === 0 && r.capital === 0) continue;
      sentencias.push(
        db.prepare('insert into reparto_socios (aplicacion_id, socio_id, interes, capital) values (?, ?, ?, ?)').bind(aplicacionId, r.socioId, r.interes, r.capital),
      );
    }
  }
  // La fila de cierre dispara la verificación de sumas del asiento en la base.
  sentencias.push(db.prepare('insert into pagos_verificados (pago_id) values (?)').bind(pagoId));

  // Pagado al cancelarse; activo otra vez si un reverso lo reabre.
  const estadoPrestamo =
    fila.estado === 'activo' && estado.cancelado ? 'pagado' : fila.estado === 'pagado' && !estado.cancelado ? 'activo' : fila.estado;
  if (estadoPrestamo !== fila.estado) {
    sentencias.push(db.prepare('update prestamos set estado = ? where id = ?').bind(estadoPrestamo, fila.id));
  }

  await db.batch(sentencias);
  return { pagoId, estadoPrestamo };
}

export async function crearPrestamo(db: D1Database, e: entrada.Objeto) {
  const clienteId = entrada.uuid(e, 'clienteId');
  const notas = entrada.textoOpcional(e, 'notas', 2000);
  const prestamo: Prestamo = {
    capital: entrada.entero(e, 'capital'),
    tasaMensualBp: entrada.entero(e, 'tasaMensualBp'),
    fechaDesembolso: entrada.fecha(e, 'fechaDesembolso'),
    plazoMeses: entrada.enteroONull(e, 'plazoMeses'),
    socios: entrada.lista(e, 'socios').map((s) => ({
      socioId: entrada.uuid(s, 'socioId'),
      tasaBp: entrada.entero(s, 'tasaBp'),
      aporteCapital: entrada.entero(s, 'aporteCapital'),
    })),
  };

  const hoy = hoyBogota();
  validarPrestamo(prestamo);
  if (prestamo.fechaDesembolso > hoy) {
    throw new ErrorNegocio('FECHA_FUTURA', `El desembolso (${prestamo.fechaDesembolso}) no puede ser posterior a hoy (${hoy})`);
  }

  const cliente = await db.prepare('select id from clientes where id = ?').bind(clienteId).first();
  if (!cliente) throw new ErrorHttp(404, 'CLIENTE_NO_EXISTE', `No existe el cliente ${clienteId}`);
  const ids = prestamo.socios.map((s) => s.socioId);
  const activos = await db
    .prepare(`select count(*) as n from socios where activo = 1 and id in (${ids.map(() => '?').join(', ')})`)
    .bind(...ids)
    .first<{ n: number }>();
  if (activos?.n !== ids.length) throw new ErrorHttp(422, 'SOCIO_INVALIDO', 'Algún socio no existe o está inactivo');

  const prestamoId = crypto.randomUUID();
  await db.batch([
    db
      .prepare(
        `insert into prestamos (id, cliente_id, capital_inicial, tasa_mensual_bp, fecha_desembolso, plazo_meses, notas)
         values (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(prestamoId, clienteId, prestamo.capital, prestamo.tasaMensualBp, prestamo.fechaDesembolso, prestamo.plazoMeses, notas),
    ...prestamo.socios.map((s) =>
      db.prepare('insert into prestamo_socios (prestamo_id, socio_id, tasa_bp, aporte_capital) values (?, ?, ?, ?)').bind(prestamoId, s.socioId, s.tasaBp, s.aporteCapital),
    ),
    // La fila de cierre dispara la verificación de sumas de socios en la base.
    db.prepare('insert into prestamos_verificados (prestamo_id) values (?)').bind(prestamoId),
  ]);

  return { prestamoId, plan: generarPlanDePagos(prestamo), estado: estadoPrestamo(prestamo, [], hoy) };
}

export async function registrarPago(db: D1Database, prestamoId: string, e: entrada.Objeto) {
  const hoy = hoyBogota();
  const fecha = entrada.fechaOpcional(e, 'fecha') ?? hoy;
  const monto = entrada.entero(e, 'monto');
  const simular = entrada.booleanoOpcional(e, 'simular') ?? false;
  const datos = leerDatosPago(e);

  return serializado(async () => {
    const d = await cargarPrestamo(db, prestamoId);
    exigirActivo(d.fila);
    const { prestamo, movimientos } = aCore(d);
    const movimiento = aplicarPago(prestamo, movimientos, { fecha, monto }, hoy);
    const estado = estadoPrestamo(prestamo, [...movimientos, { ...movimiento, id: 'nuevo' }], hoy);
    if (simular) return { simulado: true, movimiento, estado };
    const escrito = await escribirMovimiento(db, d.fila, movimientos.length + 1, movimiento, datos, estado);
    return { ...escrito, movimiento, estado };
  });
}

export async function liquidarPrestamo(db: D1Database, prestamoId: string, e: entrada.Objeto) {
  const hoy = hoyBogota();
  const fecha = entrada.fechaOpcional(e, 'fecha') ?? hoy;
  const simular = entrada.booleanoOpcional(e, 'simular') ?? false;
  const montoCotizado = simular ? null : entrada.entero(e, 'montoCotizado');
  const datos = leerDatosPago(e);

  return serializado(async () => {
    const d = await cargarPrestamo(db, prestamoId);
    exigirActivo(d.fila);
    const { prestamo, movimientos } = aCore(d);
    if (montoCotizado === null) return { simulado: true, cotizacion: cotizarLiquidacion(prestamo, movimientos, fecha, hoy) };

    const movimiento = aplicarLiquidacion(prestamo, movimientos, fecha, hoy, montoCotizado);
    const estado = estadoPrestamo(prestamo, [...movimientos, { ...movimiento, id: 'nuevo' }], hoy);
    const escrito = await escribirMovimiento(db, d.fila, movimientos.length + 1, movimiento, datos, estado);
    return { ...escrito, movimiento, estado };
  });
}

export async function reversar(db: D1Database, prestamoId: string, e: entrada.Objeto) {
  const hoy = hoyBogota();
  const pagoId = entrada.uuid(e, 'pagoId');
  const nota = entrada.textoOpcional(e, 'nota');

  return serializado(async () => {
    const d = await cargarPrestamo(db, prestamoId);
    const { prestamo, movimientos } = aCore(d);
    const movimiento = reversarPago(prestamo, movimientos, pagoId, hoy);
    const estado = estadoPrestamo(prestamo, [...movimientos, { ...movimiento, id: 'nuevo' }], hoy);
    const escrito = await escribirMovimiento(db, d.fila, movimientos.length + 1, movimiento, { medio: null, nota, soportePath: null }, estado);
    return { reversoId: escrito.pagoId, estadoPrestamo: escrito.estadoPrestamo, movimiento, estado };
  });
}
