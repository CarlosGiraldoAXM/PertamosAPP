import { assertPesos, interesMensual, type Pesos } from './dinero.ts';
import { ErrorNegocio } from './errores.ts';
import { assertFecha, fechaCorte, periodoDeFecha, type FechaISO } from './fechas.ts';
import { validarPrestamo, type Prestamo, type RepartoSocio } from './socios.ts';

export type TipoPago = 'pago' | 'liquidacion' | 'reverso';

/** Una línea de imputación: interés de un período o abono a capital. */
export interface Aplicacion {
  /** Período cuyo interés se paga; `null` si es abono a capital. */
  periodo: number | null;
  aInteres: Pesos;
  aCapital: Pesos;
  reparto: RepartoSocio[];
}

/** Un asiento del libro tal como está guardado (`pagos` + `aplicaciones` + `reparto_socios`). */
export interface Movimiento {
  id: string;
  tipo: TipoPago;
  fecha: FechaISO;
  monto: Pesos;
  reversaDe: string | null;
  aplicaciones: Aplicacion[];
}

/** Asiento calculado por `core`, listo para insertar. */
export type MovimientoNuevo = Omit<Movimiento, 'id'>;

function inconsistente(mensaje: string): ErrorNegocio {
  return new ErrorNegocio('LIBRO_INCONSISTENTE', mensaje);
}

/**
 * Verifica que el libro guardado sea coherente. Los movimientos llegan en el
 * orden en que se registraron. Es una defensa: si falla, alguien tocó la base
 * por fuera de las Edge Functions.
 */
export function validarMovimientos(prestamo: Prestamo, movimientos: readonly Movimiento[]): void {
  const socios = new Set(prestamo.socios.map((s) => s.socioId));
  const vistos = new Map<string, Movimiento>();
  const reversados = new Set<string>();

  for (const m of movimientos) {
    if (!m.id || vistos.has(m.id)) throw inconsistente(`Id de movimiento vacío o repetido: "${m.id}"`);
    assertFecha(m.fecha);
    if (m.fecha < prestamo.fechaDesembolso) throw inconsistente(`El movimiento ${m.id} es anterior al desembolso`);
    assertPesos(m.monto, `monto del movimiento ${m.id}`);

    if (m.tipo === 'reverso') {
      const original = m.reversaDe === null ? undefined : vistos.get(m.reversaDe);
      if (!original) throw inconsistente(`El reverso ${m.id} no apunta a un movimiento anterior`);
      if (original.tipo === 'reverso') throw inconsistente(`El reverso ${m.id} reversa otro reverso`);
      if (reversados.has(original.id)) throw inconsistente(`El movimiento ${original.id} está reversado dos veces`);
      if (m.monto !== -original.monto) throw inconsistente(`El reverso ${m.id} no es por el monto exacto del original`);
      reversados.add(original.id);
    } else if (m.tipo === 'pago' || m.tipo === 'liquidacion') {
      if (m.reversaDe !== null) throw inconsistente(`El movimiento ${m.id} no es un reverso pero tiene reversaDe`);
      if (m.monto <= 0) throw inconsistente(`El movimiento ${m.id} tiene monto no positivo`);
    } else {
      throw inconsistente(`Tipo de movimiento desconocido: ${String(m.tipo)}`);
    }

    const signo = m.tipo === 'reverso' ? -1 : 1;
    if (m.aplicaciones.length === 0) throw inconsistente(`El movimiento ${m.id} no tiene aplicaciones`);
    let suma = 0;
    for (const a of m.aplicaciones) {
      assertPesos(a.aInteres, 'aInteres');
      assertPesos(a.aCapital, 'aCapital');
      if (a.aInteres * signo < 0 || a.aCapital * signo < 0) throw inconsistente(`Signo incorrecto en una aplicación de ${m.id}`);
      if (a.periodo === null ? a.aInteres !== 0 : a.aCapital !== 0 || !Number.isSafeInteger(a.periodo) || a.periodo < 1) {
        throw inconsistente(`Aplicación mal formada en ${m.id}: interés va con período y capital sin período`);
      }
      suma += a.aInteres + a.aCapital;

      const ids = new Set<string>();
      let repInteres = 0;
      let repCapital = 0;
      for (const r of a.reparto) {
        if (!socios.has(r.socioId) || ids.has(r.socioId)) throw inconsistente(`Reparto con socio inválido en ${m.id}`);
        ids.add(r.socioId);
        assertPesos(r.interes, 'reparto.interes');
        assertPesos(r.capital, 'reparto.capital');
        repInteres += r.interes;
        repCapital += r.capital;
      }
      if (repInteres !== a.aInteres || repCapital !== a.aCapital) throw inconsistente(`El reparto entre socios no cuadra en ${m.id}`);
    }
    if (suma !== m.monto) throw inconsistente(`Las aplicaciones de ${m.id} suman ${suma} y el monto es ${m.monto}`);

    vistos.set(m.id, m);
  }
}

/** Vista calculada del libro: solo movimientos efectivos (sin reversados ni reversos). */
export interface Libro {
  efectivos: Movimiento[];
  capitalPagado: Pesos;
  interesPagado: Pesos;
  saldo: Pesos;
  /** Fecha del último movimiento efectivo; un pago nuevo no puede ser anterior. */
  ultimaFecha: FechaISO | null;
  /** Período en el que se liquidó el préstamo, si se liquidó. */
  periodoLiquidado: number | null;
  interesPagadoEn(periodo: number): Pesos;
  interesCobradoPor(socioId: string): Pesos;
  capitalDevueltoA(socioId: string): Pesos;
  devueltoPorSocio: ReadonlyMap<string, Pesos>;
  /** Capital pendiente al final del día del corte `k`; para k = 0, el capital inicial. */
  saldoAlCorte(k: number): Pesos;
  /** Interés que genera el período `k`. */
  interesDelPeriodo(k: number): Pesos;
}

export function analizarLibro(prestamo: Prestamo, movimientos: readonly Movimiento[]): Libro {
  validarPrestamo(prestamo);
  validarMovimientos(prestamo, movimientos);

  const reversados = new Set(movimientos.filter((m) => m.tipo === 'reverso').map((m) => m.reversaDe));
  const efectivos = movimientos.filter((m) => m.tipo !== 'reverso' && !reversados.has(m.id));

  const porPeriodo = new Map<number, Pesos>();
  const interesPorSocio = new Map<string, Pesos>();
  const devueltoPorSocio = new Map<string, Pesos>();
  let capitalPagado = 0;
  let interesPagado = 0;
  for (const m of efectivos) {
    for (const a of m.aplicaciones) {
      capitalPagado += a.aCapital;
      interesPagado += a.aInteres;
      if (a.periodo !== null) porPeriodo.set(a.periodo, (porPeriodo.get(a.periodo) ?? 0) + a.aInteres);
      for (const r of a.reparto) {
        interesPorSocio.set(r.socioId, (interesPorSocio.get(r.socioId) ?? 0) + r.interes);
        devueltoPorSocio.set(r.socioId, (devueltoPorSocio.get(r.socioId) ?? 0) + r.capital);
      }
    }
  }
  if (capitalPagado > prestamo.capital) throw inconsistente('Se devolvió más capital que el prestado');

  const liquidacion = efectivos.find((m) => m.tipo === 'liquidacion');
  const periodoLiquidado = liquidacion ? periodoDeFecha(prestamo.fechaDesembolso, liquidacion.fecha) : null;
  const interesPagadoEn = (periodo: number) => porPeriodo.get(periodo) ?? 0;

  const saldoAlCorte = (k: number): Pesos => {
    // Un pago el día del desembolso pertenece al período 1; su abono baja el interés desde el período 2.
    if (k === 0) return prestamo.capital;
    const corte = fechaCorte(prestamo.fechaDesembolso, k);
    let saldo = prestamo.capital;
    for (const m of efectivos) {
      if (m.fecha > corte) continue;
      for (const a of m.aplicaciones) saldo -= a.aCapital;
    }
    return saldo;
  };

  return {
    efectivos,
    capitalPagado,
    interesPagado,
    saldo: prestamo.capital - capitalPagado,
    ultimaFecha: efectivos.reduce<FechaISO | null>((u, m) => (u === null || m.fecha > u ? m.fecha : u), null),
    periodoLiquidado,
    interesPagadoEn,
    interesCobradoPor: (socioId) => interesPorSocio.get(socioId) ?? 0,
    capitalDevueltoA: (socioId) => devueltoPorSocio.get(socioId) ?? 0,
    devueltoPorSocio,
    saldoAlCorte,
    interesDelPeriodo(k) {
      if (periodoLiquidado !== null) {
        // La liquidación cobra el período en curso prorrateado y cierra el préstamo.
        if (k === periodoLiquidado) return interesPagadoEn(k);
        if (k > periodoLiquidado) return 0;
      }
      return interesMensual(saldoAlCorte(k - 1), prestamo.tasaMensualBp);
    },
  };
}
