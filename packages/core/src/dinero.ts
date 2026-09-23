import { ErrorNegocio } from './errores.ts';

/** Pesos colombianos enteros. Nunca fraccionarios. */
export type Pesos = number;

/** Puntos básicos: 300 = 3.00 %. */
export type PuntosBasicos = number;

const BP_POR_UNIDAD = 10_000n;

export function assertPesos(valor: number, nombre = 'monto'): void {
  if (!Number.isSafeInteger(valor)) {
    throw new ErrorNegocio('MONTO_INVALIDO', `${nombre} debe ser un entero de pesos, llegó ${valor}`);
  }
}

export function assertPesosNoNegativos(valor: number, nombre = 'monto'): void {
  assertPesos(valor, nombre);
  if (valor < 0) throw new ErrorNegocio('MONTO_INVALIDO', `${nombre} no puede ser negativo, llegó ${valor}`);
}

export function assertBp(valor: number, nombre = 'tasa'): void {
  if (!Number.isSafeInteger(valor) || valor < 0) {
    throw new ErrorNegocio('TASA_INVALIDA', `${nombre} debe ser un entero de puntos básicos ≥ 0, llegó ${valor}`);
  }
}

function aPesos(valor: bigint): Pesos {
  const n = Number(valor);
  if (!Number.isSafeInteger(n)) throw new ErrorNegocio('MONTO_FUERA_DE_RANGO', `Monto fuera de rango: ${valor}`);
  return n;
}

/** `num / den` redondeado al entero más cercano, mitades alejándose de cero. `den > 0`. */
function dividirRedondeando(num: bigint, den: bigint): bigint {
  const negativo = num < 0n;
  const abs = negativo ? -num : num;
  const q = (abs * 2n + den) / (den * 2n);
  return negativo ? -q : q;
}

/** Interés de un mes completo: `saldo · tasa`, redondeado al peso. */
export function interesMensual(saldo: Pesos, tasaBp: PuntosBasicos): Pesos {
  assertPesosNoNegativos(saldo, 'saldo');
  assertBp(tasaBp);
  return aPesos(dividirRedondeando(BigInt(saldo) * BigInt(tasaBp), BP_POR_UNIDAD));
}

/** Interés de `dias` (0..30) sobre base 30/360, redondeado al peso. */
export function interesProporcional(saldo: Pesos, tasaBp: PuntosBasicos, dias: number): Pesos {
  assertPesosNoNegativos(saldo, 'saldo');
  assertBp(tasaBp);
  if (!Number.isSafeInteger(dias) || dias < 0 || dias > 30) {
    throw new ErrorNegocio('DIAS_INVALIDOS', `Los días deben estar entre 0 y 30, llegó ${dias}`);
  }
  return aPesos(dividirRedondeando(BigInt(saldo) * BigInt(tasaBp) * BigInt(dias), BP_POR_UNIDAD * 30n));
}

/** Redondea hacia arriba al múltiplo de 1.000 más cercano. */
export function techoMil(valor: Pesos): Pesos {
  assertPesosNoNegativos(valor);
  return Math.ceil(valor / 1000) * 1000;
}

/**
 * Reparte `total` en partes proporcionales a `pesos`. Cada parte se trunca y
 * la última con peso > 0 absorbe el residuo, así que la suma es siempre
 * exactamente `total`. Una parte con peso 0 recibe 0. Admite `total` negativo
 * (reversos): se reparte el valor absoluto y se niega.
 */
export function repartirProporcional(total: Pesos, pesos: readonly number[]): Pesos[] {
  assertPesos(total, 'total');
  if (pesos.length === 0) throw new ErrorNegocio('PESOS_INVALIDOS', 'No hay partes entre las cuales repartir');
  pesos.forEach((p, i) => assertPesosNoNegativos(p, `peso[${i}]`));

  const sumaPesos = pesos.reduce((s, p) => s + BigInt(p), 0n);
  if (sumaPesos === 0n) throw new ErrorNegocio('PESOS_INVALIDOS', 'La suma de los pesos es 0');

  const negativo = total < 0;
  const abs = BigInt(negativo ? -total : total);
  const partes = pesos.map((p) => (abs * BigInt(p)) / sumaPesos);

  let ultimaConPeso = pesos.length - 1;
  while (pesos[ultimaConPeso] === 0) ultimaConPeso--;
  const repartido = partes.reduce((s, p) => s + p, 0n);
  partes[ultimaConPeso] = partes[ultimaConPeso]! + (abs - repartido);

  return partes.map((p) => (negativo && p !== 0n ? -aPesos(p) : aPesos(p)));
}

/**
 * Reparte `total` (0 ≤ total ≤ Σ topes) en proporción a `topes` sin que
 * ninguna parte supere su tope: cada parte queda en el piso o el techo de su
 * valor exacto (método del mayor residuo; empates al primero). Se usa para
 * devolver capital: cada socio recibe en proporción a lo que aún se le debe
 * y el pago que cancela la deuda le devuelve exactamente su saldo.
 */
export function repartirSinExceder(total: Pesos, topes: readonly Pesos[]): Pesos[] {
  assertPesosNoNegativos(total, 'total');
  topes.forEach((t, i) => assertPesosNoNegativos(t, `tope[${i}]`));
  const suma = topes.reduce((s, t) => s + BigInt(t), 0n);
  const t = BigInt(total);
  if (t > suma) throw new ErrorNegocio('REPARTO_EXCEDE_TOPES', `No se pueden repartir ${total} con topes que suman ${suma}`);
  if (t === 0n) return topes.map(() => 0);

  const exactas = topes.map((tope, i) => ({ i, q: (t * BigInt(tope)) / suma, r: (t * BigInt(tope)) % suma }));
  let residuo = t - exactas.reduce((s, x) => s + x.q, 0n);
  const orden = [...exactas].sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  for (const x of orden) {
    if (residuo === 0n) break;
    x.q += 1n;
    residuo -= 1n;
  }
  return exactas.map((x) => aPesos(x.q));
}
