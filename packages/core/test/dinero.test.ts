import { describe, expect, it } from 'vitest';
import { interesMensual, interesProporcional, repartirProporcional, repartirSinExceder, techoMil } from '../src/dinero.ts';
import { ErrorNegocio } from '../src/errores.ts';
import { crearAleatorio } from './aleatorio.ts';

describe('interesMensual', () => {
  it('calcula saldo · tasa redondeado al peso', () => {
    expect(interesMensual(1_000_000, 300)).toBe(30_000);
    expect(interesMensual(1_234_567, 300)).toBe(37_037); // 37.037,01
    expect(interesMensual(2_500_000, 500)).toBe(125_000);
    expect(interesMensual(0, 300)).toBe(0);
  });

  it('redondea mitades hacia arriba', () => {
    expect(interesMensual(50, 100)).toBe(1); // 0,5
    expect(interesMensual(49, 100)).toBe(0); // 0,49
    expect(interesMensual(150, 100)).toBe(2); // 1,5
  });

  it('no pierde precisión con saldos enormes', () => {
    // 9e15 · 500 supera 2^53; se multiplica en BigInt.
    expect(interesMensual(9_000_000_000_000_000, 500)).toBe(450_000_000_000_000);
  });

  it('rechaza montos fraccionarios o negativos y tasas inválidas', () => {
    expect(() => interesMensual(1000.5, 300)).toThrow(ErrorNegocio);
    expect(() => interesMensual(-1, 300)).toThrow(ErrorNegocio);
    expect(() => interesMensual(1000, 2.5)).toThrow(ErrorNegocio);
    expect(() => interesMensual(1000, -1)).toThrow(ErrorNegocio);
  });
});

describe('interesProporcional', () => {
  it('30 días equivalen al mes completo', () => {
    expect(interesProporcional(1_234_567, 300, 30)).toBe(interesMensual(1_234_567, 300));
  });

  it('prorratea por días en base 30', () => {
    expect(interesProporcional(1_000_000, 300, 12)).toBe(12_000);
    expect(interesProporcional(1_000_000, 300, 1)).toBe(1_000);
    expect(interesProporcional(1_000_000, 300, 0)).toBe(0);
    expect(interesProporcional(1_000_001, 300, 7)).toBe(7_000); // 7.000,007
  });

  it('rechaza días fuera de 0..30', () => {
    expect(() => interesProporcional(1000, 300, 31)).toThrow(ErrorNegocio);
    expect(() => interesProporcional(1000, 300, -1)).toThrow(ErrorNegocio);
  });
});

describe('techoMil', () => {
  it('redondea hacia arriba a los mil', () => {
    expect(techoMil(37_037)).toBe(38_000);
    expect(techoMil(38_000)).toBe(38_000);
    expect(techoMil(38_001)).toBe(39_000);
    expect(techoMil(1)).toBe(1_000);
    expect(techoMil(0)).toBe(0);
  });
});

describe('repartirProporcional', () => {
  it('reparte 5 % como 1 % + 4 % → 20 % / 80 %', () => {
    expect(repartirProporcional(50_000, [100, 400])).toEqual([10_000, 40_000]);
  });

  it('reparte 3 % como 1 % + 2 %, la última absorbe el residuo', () => {
    expect(repartirProporcional(37_037, [100, 200])).toEqual([12_345, 24_692]);
    expect(repartirProporcional(100, [1, 2])).toEqual([33, 67]);
  });

  it('una parte con peso 0 recibe 0 aunque sea la última', () => {
    expect(repartirProporcional(7, [1, 1, 0])).toEqual([3, 4, 0]);
    expect(repartirProporcional(7, [0, 1, 0])).toEqual([0, 7, 0]);
  });

  it('reparte totales negativos (reversos) en espejo', () => {
    expect(repartirProporcional(-100, [1, 2])).toEqual([-33, -67]);
    expect(repartirProporcional(-7, [1, 1, 0])).toEqual([-3, -4, 0]);
  });

  it('reparte 0 en ceros', () => {
    expect(repartirProporcional(0, [1, 2])).toEqual([0, 0]);
  });

  it('rechaza entradas inválidas', () => {
    expect(() => repartirProporcional(100, [])).toThrow(ErrorNegocio);
    expect(() => repartirProporcional(100, [0, 0])).toThrow(ErrorNegocio);
    expect(() => repartirProporcional(100, [1, -1])).toThrow(ErrorNegocio);
    expect(() => repartirProporcional(100.5, [1, 1])).toThrow(ErrorNegocio);
    expect(() => repartirProporcional(100, [1, 0.5])).toThrow(ErrorNegocio);
  });

  it('propiedad: la suma cuadra siempre al peso y cada parte es casi exacta', () => {
    const r = crearAleatorio(3);
    for (let i = 0; i < 20_000; i++) {
      const n = r.entero(1, 6);
      const pesos: number[] = Array.from({ length: n }, () => (r.siguiente() < 0.2 ? 0 : r.entero(1, 10_000)));
      if (!pesos.some((p) => p > 0)) pesos[r.entero(0, n - 1)] = r.entero(1, 10_000);
      const magnitud = r.entero(0, 12);
      let total = r.entero(0, 10 ** magnitud);
      if (r.siguiente() < 0.2 && total !== 0) total = -total;

      const partes = repartirProporcional(total, pesos);
      expect(partes.reduce((s, p) => s + p, 0)).toBe(total);

      const sumaPesos = pesos.reduce((s, p) => s + p, 0);
      partes.forEach((p, j) => {
        expect(Number.isSafeInteger(p)).toBe(true);
        if (pesos[j] === 0) expect(p).toBe(0);
        // Cada parte difiere de la exacta en menos de `n` pesos (truncamiento + residuo).
        expect(Math.abs(p - (total * pesos[j]!) / sumaPesos)).toBeLessThan(n);
      });
    }
  });
});

describe('repartirSinExceder', () => {
  it('reparte en proporción a los topes', () => {
    expect(repartirSinExceder(200_000, [400_000, 600_000])).toEqual([80_000, 120_000]);
    expect(repartirSinExceder(2, [1, 1, 1])).toEqual([1, 1, 0]);
    expect(repartirSinExceder(10, [5, 5, 5])).toEqual([4, 3, 3]);
  });

  it('repartir el total de los topes devuelve exactamente los topes', () => {
    expect(repartirSinExceder(1_000, [333, 0, 667])).toEqual([333, 0, 667]);
  });

  it('rechaza repartir más que la suma de topes', () => {
    expect(() => repartirSinExceder(11, [5, 5])).toThrow(ErrorNegocio);
    expect(() => repartirSinExceder(1, [0, 0])).toThrow(ErrorNegocio);
  });

  it('propiedad: cuadra, no excede ningún tope y cada parte queda en piso/techo de la exacta', () => {
    const r = crearAleatorio(6);
    for (let i = 0; i < 20_000; i++) {
      const n = r.entero(1, 5);
      const topes: number[] = Array.from({ length: n }, () => (r.siguiente() < 0.2 ? 0 : r.entero(1, 10 ** r.entero(0, 9))));
      const suma = topes.reduce((s, t) => s + t, 0);
      const total = r.entero(0, suma);
      const partes = repartirSinExceder(total, topes);
      expect(partes.reduce((s, p) => s + p, 0)).toBe(total);
      partes.forEach((p, j) => {
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThanOrEqual(topes[j]!);
        if (suma > 0) expect(Math.abs(p - (total * topes[j]!) / suma)).toBeLessThan(1 + 1e-6);
      });
    }
  });
});
