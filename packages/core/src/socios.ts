import { assertBp, assertPesosNoNegativos, repartirProporcional, repartirSinExceder, type Pesos, type PuntosBasicos } from './dinero.ts';
import { ErrorNegocio } from './errores.ts';
import { validarCondiciones, type CondicionesPrestamo } from './plan.ts';

export interface ParticipacionSocio {
  socioId: string;
  /** Puntos de la tasa mensual que son de este socio. Define su parte del interés. */
  tasaBp: PuntosBasicos;
  /** Capital que puso este socio. Define su parte de cada devolución de capital. */
  aporteCapital: Pesos;
}

export interface Prestamo extends CondicionesPrestamo {
  socios: ParticipacionSocio[];
}

export interface RepartoSocio {
  socioId: string;
  interes: Pesos;
  capital: Pesos;
}

export function validarPrestamo(p: Prestamo): void {
  validarCondiciones(p);
  if (p.socios.length === 0) throw new ErrorNegocio('SOCIOS_INVALIDOS', 'El préstamo debe tener al menos un socio');

  const ids = new Set<string>();
  let sumaTasas = 0;
  let sumaAportes = 0;
  for (const s of p.socios) {
    if (!s.socioId) throw new ErrorNegocio('SOCIOS_INVALIDOS', 'Hay un socio sin identificador');
    if (ids.has(s.socioId)) throw new ErrorNegocio('SOCIOS_INVALIDOS', `El socio ${s.socioId} está repetido`);
    ids.add(s.socioId);
    assertBp(s.tasaBp, `tasa del socio ${s.socioId}`);
    assertPesosNoNegativos(s.aporteCapital, `aporte del socio ${s.socioId}`);
    sumaTasas += s.tasaBp;
    sumaAportes += s.aporteCapital;
  }
  if (sumaTasas !== p.tasaMensualBp) {
    throw new ErrorNegocio(
      'SOCIOS_TASA_NO_CUADRA',
      `Las tasas de los socios suman ${sumaTasas} bp y la tasa del préstamo es ${p.tasaMensualBp} bp`,
    );
  }
  if (sumaAportes !== p.capital) {
    throw new ErrorNegocio(
      'SOCIOS_CAPITAL_NO_CUADRA',
      `Los aportes de los socios suman ${sumaAportes} y el capital del préstamo es ${p.capital}`,
    );
  }
}

/** Interés repartido por la parte de la tasa de cada socio. */
export function repartirInteres(monto: Pesos, socios: readonly ParticipacionSocio[]): RepartoSocio[] {
  const partes = repartirProporcional(monto, socios.map((s) => s.tasaBp));
  return socios.map((s, i) => ({ socioId: s.socioId, interes: partes[i]!, capital: 0 }));
}

/**
 * Capital devuelto repartido por lo que aún se le debe a cada socio
 * (`aporte − ya devuelto`). Nadie recibe más de su aporte y el pago que
 * cancela el préstamo deja a cada socio con su aporte exacto.
 */
export function repartirCapital(
  monto: Pesos,
  socios: readonly ParticipacionSocio[],
  devueltoPorSocio: ReadonlyMap<string, Pesos>,
): RepartoSocio[] {
  const pendientes = socios.map((s) => s.aporteCapital - (devueltoPorSocio.get(s.socioId) ?? 0));
  const partes = repartirSinExceder(monto, pendientes);
  return socios.map((s, i) => ({ socioId: s.socioId, interes: 0, capital: partes[i]! }));
}
