import { ErrorNegocio } from './errores.ts';

/** Fecha calendario `YYYY-MM-DD`, sin hora ni zona. */
export type FechaISO = string;

export interface PartesFecha {
  anio: number;
  mes: number; // 1..12
  dia: number; // 1..31
}

const FORMATO = /^(\d{4})-(\d{2})-(\d{2})$/;

export function esBisiesto(anio: number): boolean {
  return (anio % 4 === 0 && anio % 100 !== 0) || anio % 400 === 0;
}

export function diasEnMes(anio: number, mes: number): number {
  if (mes === 2) return esBisiesto(anio) ? 29 : 28;
  return mes === 4 || mes === 6 || mes === 9 || mes === 11 ? 30 : 31;
}

export function parseFecha(fecha: FechaISO): PartesFecha {
  const m = FORMATO.exec(fecha);
  if (!m) throw new ErrorNegocio('FECHA_INVALIDA', `Fecha con formato inválido: "${fecha}" (se espera YYYY-MM-DD)`);
  const anio = Number(m[1]);
  const mes = Number(m[2]);
  const dia = Number(m[3]);
  if (anio < 1900 || mes < 1 || mes > 12 || dia < 1 || dia > diasEnMes(anio, mes)) {
    throw new ErrorNegocio('FECHA_INVALIDA', `Fecha inexistente: "${fecha}"`);
  }
  return { anio, mes, dia };
}

export function formatFecha({ anio, mes, dia }: PartesFecha): FechaISO {
  return `${String(anio).padStart(4, '0')}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

export function assertFecha(fecha: FechaISO): void {
  parseFecha(fecha);
}

/** -1, 0 o 1. Válido porque `YYYY-MM-DD` ordena lexicográficamente igual que cronológicamente. */
export function compararFechas(a: FechaISO, b: FechaISO): -1 | 0 | 1 {
  assertFecha(a);
  assertFecha(b);
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Fecha del corte `k` de un préstamo: el mismo día del desembolso, `k` meses
 * después, limitado al último día del mes. Se calcula siempre desde el
 * desembolso (no encadenado): 31-ene → 28-feb → 31-mar.
 * `fechaCorte(d, 0)` es el propio desembolso.
 */
export function fechaCorte(desembolso: FechaISO, k: number): FechaISO {
  if (!Number.isSafeInteger(k) || k < 0) {
    throw new ErrorNegocio('PERIODO_INVALIDO', `Número de corte inválido: ${k}`);
  }
  const d = parseFecha(desembolso);
  const total = d.anio * 12 + (d.mes - 1) + k;
  const anio = Math.floor(total / 12);
  const mes = (total % 12) + 1;
  return formatFecha({ anio, mes, dia: Math.min(d.dia, diasEnMes(anio, mes)) });
}

/**
 * Número del período al que pertenece `fecha`: el `k ≥ 1` tal que
 * `corte(k-1) < fecha ≤ corte(k)`. Un pago el día del desembolso cae en el período 1.
 */
export function periodoDeFecha(desembolso: FechaISO, fecha: FechaISO): number {
  if (compararFechas(fecha, desembolso) < 0) {
    throw new ErrorNegocio('FECHA_ANTES_DE_DESEMBOLSO', `La fecha ${fecha} es anterior al desembolso ${desembolso}`);
  }
  const d = parseFecha(desembolso);
  const f = parseFecha(fecha);
  // corte(meses) cae en el mismo mes calendario que `fecha`.
  const meses = (f.anio - d.anio) * 12 + (f.mes - d.mes);
  const k = Math.max(1, meses);
  return fechaCorte(desembolso, k) >= fecha ? k : k + 1;
}

// Días desde 1970-01-01 (algoritmo days_from_civil de H. Hinnant), en aritmética entera.
function aDiaAbsoluto({ anio, mes, dia }: PartesFecha): number {
  const y = mes <= 2 ? anio - 1 : anio;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * ((mes + 9) % 12) + 2) / 5) + dia - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

function desdeDiaAbsoluto(z: number): PartesFecha {
  const zz = z + 719468;
  const era = Math.floor(zz / 146097);
  const doe = zz - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const mes = mp < 10 ? mp + 3 : mp - 9;
  return { anio: yoe + era * 400 + (mes <= 2 ? 1 : 0), mes, dia: doy - Math.floor((153 * mp + 2) / 5) + 1 };
}

/** Días calendario de `desde` a `hasta` (negativo si `hasta` es anterior). */
export function diasEntre(desde: FechaISO, hasta: FechaISO): number {
  return aDiaAbsoluto(parseFecha(hasta)) - aDiaAbsoluto(parseFecha(desde));
}

export function sumarDias(fecha: FechaISO, dias: number): FechaISO {
  if (!Number.isSafeInteger(dias)) throw new ErrorNegocio('DIAS_INVALIDOS', `Días inválidos: ${dias}`);
  const resultado = formatFecha(desdeDiaAbsoluto(aDiaAbsoluto(parseFecha(fecha)) + dias));
  assertFecha(resultado);
  return resultado;
}

/**
 * Días entre dos fechas en base 30E/360 (europea): cada mes cuenta 30 días y
 * el día 31 se trata como 30.
 */
export function dias30E360(desde: FechaISO, hasta: FechaISO): number {
  if (compararFechas(hasta, desde) < 0) {
    throw new ErrorNegocio('RANGO_FECHAS_INVALIDO', `"${hasta}" es anterior a "${desde}"`);
  }
  const a = parseFecha(desde);
  const b = parseFecha(hasta);
  return 360 * (b.anio - a.anio) + 30 * (b.mes - a.mes) + (Math.min(b.dia, 30) - Math.min(a.dia, 30));
}
