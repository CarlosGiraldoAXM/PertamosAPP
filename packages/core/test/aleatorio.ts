import { formatFecha, diasEnMes, type FechaISO } from '../src/fechas.ts';

/** PRNG determinístico (mulberry32) para que los tests aleatorios sean reproducibles. */
export function crearAleatorio(semilla: number) {
  let s = semilla >>> 0;
  const siguiente = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const entero = (min: number, max: number): number => min + Math.floor(siguiente() * (max - min + 1));
  const fecha = (anioMin = 2000, anioMax = 2060): FechaISO => {
    const anio = entero(anioMin, anioMax);
    const mes = entero(1, 12);
    return formatFecha({ anio, mes, dia: entero(1, diasEnMes(anio, mes)) });
  };
  return { siguiente, entero, fecha };
}
