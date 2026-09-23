// Formatos de pantalla. Internamente todo es pesos enteros y puntos básicos.

const miles = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 });

/** `$ 1.250.000` (negativos como `-$ 1.250.000`). */
export function pesos(valor: number): string {
  return `${valor < 0 ? '-' : ''}$ ${miles.format(Math.abs(valor))}`;
}

/** Solo los dígitos de lo que escribe el usuario, como pesos enteros. */
export function leerPesos(texto: string): number | null {
  const digitos = texto.replace(/\D/g, '');
  if (digitos === '') return null;
  const n = Number(digitos);
  return Number.isSafeInteger(n) ? n : null;
}

/** Muestra un monto mientras se escribe: "1250000" → "1.250.000". */
export function escribirPesos(texto: string): string {
  const n = leerPesos(texto);
  return n === null ? '' : miles.format(n);
}

/** 300 → "3 %", 150 → "1,5 %", 125 → "1,25 %". */
export function porcentaje(bp: number): string {
  const entero = Math.trunc(bp / 100);
  const resto = Math.abs(bp % 100);
  const decimales = resto === 0 ? '' : `,${String(resto).padStart(2, '0').replace(/0$/, '')}`;
  return `${entero}${decimales} %`;
}

/**
 * "3" → 300, "1,5" o "1.5" → 150, "0,25" → 25. Máximo dos decimales. Se
 * convierte desde el texto, sin pasar por números con coma flotante.
 */
export function leerPorcentajeABp(texto: string): number | null {
  const limpio = texto.trim().replace(',', '.');
  const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(limpio);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** '2026-03-15' → '15 mar 2026'. Sin pasar por Date. */
export function fechaCorta(iso: string): string {
  const [a, m, d] = iso.split('-');
  return `${Number(d)} ${MESES[Number(m) - 1]} ${a}`;
}
