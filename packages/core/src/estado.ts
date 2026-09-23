import { repartirProporcional, techoMil, type Pesos, type PuntosBasicos } from './dinero.ts';
import { ErrorNegocio } from './errores.ts';
import { assertFecha, diasEntre, fechaCorte, periodoDeFecha, type FechaISO } from './fechas.ts';
import { analizarLibro, type Movimiento } from './libro.ts';
import { proyectarCortes, type CorteProyectado, type OpcionesPlan } from './plan.ts';
import type { Prestamo } from './socios.ts';

export interface ResumenPeriodo {
  numero: number;
  fechaInicio: FechaISO;
  fechaCorte: FechaISO;
  /** Saldo sobre el que se calculó el interés (capital al corte anterior). */
  saldoBase: Pesos;
  interes: Pesos;
  pagado: Pesos;
  pendiente: Pesos;
  vencido: boolean;
}

export interface Cobro {
  interesExacto: Pesos;
  /** Redondeado hacia arriba a los mil (sin pasar de interés + saldo). */
  cuotaACobrar: Pesos;
}

export interface ResumenSocio {
  socioId: string;
  tasaBp: PuntosBasicos;
  aporteCapital: Pesos;
  interesCobrado: Pesos;
  capitalDevuelto: Pesos;
  capitalPendiente: Pesos;
  interesVencidoPendiente: Pesos;
  interesProyectado: Pesos;
}

export interface EstadoFinanciero {
  fecha: FechaISO;
  saldoCapital: Pesos;
  capitalPagado: Pesos;
  interesPagado: Pesos;
  /** Sin capital ni interés pendiente. */
  cancelado: boolean;
  /** Período en el que cae `fecha`. */
  periodoActual: number;
  periodos: ResumenPeriodo[];
  interesVencidoPendiente: Pesos;
  periodosAtrasados: number;
  /** Días calendario desde el corte vencido más antiguo sin pagar. */
  diasAtraso: number;
  /** Lo que el cliente debe hoy (interés vencido). */
  aCobrarHoy: Cobro;
  proximoCorte: (Cobro & { numero: number; fecha: FechaISO }) | null;
  /** Hay plazo, ya pasó y queda capital. */
  plazoVencido: boolean;
  /** Cortes futuros desde `proximoCorte` (hasta el plazo, o el horizonte si no hay plazo). */
  proyeccion: CorteProyectado[];
  /** Interés vencido pendiente + interés de la proyección. */
  interesProyectado: Pesos;
  /** Capital + interés total del préstamo, si tiene plazo. */
  totalProyectadoAlFinal: Pesos | null;
  socios: ResumenSocio[];
}

function cobro(interes: Pesos, saldo: Pesos): Cobro {
  return { interesExacto: interes, cuotaACobrar: Math.min(techoMil(interes), interes + saldo) };
}

export function estadoPrestamo(
  prestamo: Prestamo,
  movimientos: readonly Movimiento[],
  hoy: FechaISO,
  opciones: OpcionesPlan = {},
): EstadoFinanciero {
  const libro = analizarLibro(prestamo, movimientos);
  assertFecha(hoy);
  if (hoy < prestamo.fechaDesembolso) {
    throw new ErrorNegocio('FECHA_ANTES_DE_DESEMBOLSO', `La fecha ${hoy} es anterior al desembolso`);
  }
  const d = prestamo.fechaDesembolso;
  const k = periodoDeFecha(d, hoy);

  const periodos: ResumenPeriodo[] = [];
  for (let j = 1; j <= k; j++) {
    const interes = libro.interesDelPeriodo(j);
    const pagado = libro.interesPagadoEn(j);
    const corte = fechaCorte(d, j);
    periodos.push({
      numero: j,
      fechaInicio: fechaCorte(d, j - 1),
      fechaCorte: corte,
      saldoBase: libro.saldoAlCorte(j - 1),
      interes,
      pagado,
      pendiente: Math.max(0, interes - pagado),
      vencido: corte <= hoy,
    });
  }

  const atrasados = periodos.filter((p) => p.vencido && p.pendiente > 0);
  const interesVencidoPendiente = atrasados.reduce((s, p) => s + p.pendiente, 0);
  const cancelado = libro.saldo === 0 && interesVencidoPendiente === 0;

  let proximoCorte: EstadoFinanciero['proximoCorte'] = null;
  let proyeccion: CorteProyectado[] = [];
  if (!cancelado && libro.saldo > 0) {
    const p = fechaCorte(d, k) === hoy ? k + 1 : k;
    const pendiente = Math.max(0, libro.interesDelPeriodo(p) - libro.interesPagadoEn(p));
    const cantidad = prestamo.plazoMeses !== null ? Math.max(1, prestamo.plazoMeses - p + 1) : (opciones.horizonteMeses ?? 12);
    proyeccion = proyectarCortes(prestamo, libro.saldo, p, cantidad, { interesPrimerCorte: pendiente });
    proximoCorte = {
      numero: p,
      fecha: fechaCorte(d, p),
      interesExacto: pendiente,
      cuotaACobrar: proyeccion[0]!.cuotaACobrar,
    };
  }

  const interesProyectado = interesVencidoPendiente + proyeccion.reduce((s, c) => s + c.interesExacto, 0);
  const totalProyectadoAlFinal =
    prestamo.plazoMeses === null
      ? null
      : libro.capitalPagado + libro.interesPagado + interesVencidoPendiente + proyeccion.reduce((s, c) => s + c.cuotaACobrar, 0);

  const tasas = prestamo.socios.map((s) => s.tasaBp);
  const vencidoPorSocio = repartirProporcional(interesVencidoPendiente, tasas);
  const proyectadoPorSocio = repartirProporcional(interesProyectado, tasas);

  return {
    fecha: hoy,
    saldoCapital: libro.saldo,
    capitalPagado: libro.capitalPagado,
    interesPagado: libro.interesPagado,
    cancelado,
    periodoActual: k,
    periodos,
    interesVencidoPendiente,
    periodosAtrasados: atrasados.length,
    diasAtraso: atrasados.length > 0 ? diasEntre(atrasados[0]!.fechaCorte, hoy) : 0,
    aCobrarHoy: cobro(interesVencidoPendiente, libro.saldo),
    proximoCorte,
    plazoVencido: prestamo.plazoMeses !== null && libro.saldo > 0 && fechaCorte(d, prestamo.plazoMeses) <= hoy,
    proyeccion,
    interesProyectado,
    totalProyectadoAlFinal,
    socios: prestamo.socios.map((s, i) => {
      const capitalDevuelto = libro.capitalDevueltoA(s.socioId);
      return {
        socioId: s.socioId,
        tasaBp: s.tasaBp,
        aporteCapital: s.aporteCapital,
        interesCobrado: libro.interesCobradoPor(s.socioId),
        capitalDevuelto,
        capitalPendiente: s.aporteCapital - capitalDevuelto,
        interesVencidoPendiente: vencidoPorSocio[i]!,
        interesProyectado: proyectadoPorSocio[i]!,
      };
    }),
  };
}
