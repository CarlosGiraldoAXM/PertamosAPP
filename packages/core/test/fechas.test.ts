import { describe, expect, it } from 'vitest';
import { ErrorNegocio } from '../src/errores.ts';
import {
  compararFechas,
  dias30E360,
  diasEntre,
  diasEnMes,
  fechaCorte,
  parseFecha,
  periodoDeFecha,
  sumarDias,
} from '../src/fechas.ts';
import { crearAleatorio } from './aleatorio.ts';

describe('parseFecha', () => {
  it('acepta fechas válidas, incluido 29 de febrero bisiesto', () => {
    expect(parseFecha('2026-09-22')).toEqual({ anio: 2026, mes: 9, dia: 22 });
    expect(parseFecha('2024-02-29')).toEqual({ anio: 2024, mes: 2, dia: 29 });
    expect(parseFecha('2000-02-29').dia).toBe(29);
  });

  it.each(['2026-02-29', '2100-02-29', '2026-04-31', '2026-13-01', '2026-00-10', '2026-9-22', '22/09/2026', '', '2026-09-22T00:00'])(
    'rechaza "%s"',
    (f) => {
      expect(() => parseFecha(f)).toThrow(ErrorNegocio);
    },
  );
});

describe('diasEnMes', () => {
  it('conoce los meses cortos y los bisiestos', () => {
    expect(diasEnMes(2026, 2)).toBe(28);
    expect(diasEnMes(2024, 2)).toBe(29);
    expect(diasEnMes(1900, 2)).toBe(28);
    expect(diasEnMes(2026, 4)).toBe(30);
    expect(diasEnMes(2026, 12)).toBe(31);
  });
});

describe('fechaCorte', () => {
  it('el corte 0 es el desembolso', () => {
    expect(fechaCorte('2026-03-15', 0)).toBe('2026-03-15');
  });

  it('corta el mismo día de cada mes siguiente', () => {
    expect(fechaCorte('2026-03-15', 1)).toBe('2026-04-15');
    expect(fechaCorte('2026-03-15', 10)).toBe('2027-01-15');
    expect(fechaCorte('2026-12-05', 1)).toBe('2027-01-05');
  });

  it('en meses cortos vence el último día del mes, sin arrastrar el recorte', () => {
    expect(fechaCorte('2026-01-31', 1)).toBe('2026-02-28');
    expect(fechaCorte('2026-01-31', 2)).toBe('2026-03-31');
    expect(fechaCorte('2026-01-31', 3)).toBe('2026-04-30');
    expect(fechaCorte('2024-01-30', 1)).toBe('2024-02-29');
    expect(fechaCorte('2026-08-31', 1)).toBe('2026-09-30');
  });

  it('rechaza números de corte inválidos', () => {
    expect(() => fechaCorte('2026-01-01', -1)).toThrow(ErrorNegocio);
    expect(() => fechaCorte('2026-01-01', 1.5)).toThrow(ErrorNegocio);
  });

  it('propiedad: los cortes son estrictamente crecientes y caen uno por mes', () => {
    const r = crearAleatorio(1);
    for (let i = 0; i < 300; i++) {
      const d = r.fecha();
      let anterior = d;
      for (let k = 1; k <= 60; k++) {
        const c = fechaCorte(d, k);
        expect(compararFechas(c, anterior)).toBe(1);
        const pa = parseFecha(anterior);
        const pc = parseFecha(c);
        expect((pc.anio - pa.anio) * 12 + (pc.mes - pa.mes)).toBe(1);
        anterior = c;
      }
    }
  });
});

describe('periodoDeFecha', () => {
  it('ubica fechas dentro de (corte k-1, corte k]', () => {
    const d = '2026-01-15';
    expect(periodoDeFecha(d, '2026-01-15')).toBe(1);
    expect(periodoDeFecha(d, '2026-01-16')).toBe(1);
    expect(periodoDeFecha(d, '2026-02-15')).toBe(1); // el día de corte pertenece al período que vence
    expect(periodoDeFecha(d, '2026-02-16')).toBe(2);
    expect(periodoDeFecha(d, '2026-03-01')).toBe(2);
  });

  it('respeta cortes recortados a fin de mes', () => {
    const d = '2026-01-31';
    expect(periodoDeFecha(d, '2026-02-28')).toBe(1);
    expect(periodoDeFecha(d, '2026-03-01')).toBe(2);
    expect(periodoDeFecha(d, '2026-03-31')).toBe(2);
    expect(periodoDeFecha(d, '2026-04-01')).toBe(3);
  });

  it('rechaza fechas anteriores al desembolso', () => {
    expect(() => periodoDeFecha('2026-01-15', '2026-01-14')).toThrow(ErrorNegocio);
  });

  it('propiedad: corte(k-1) < fecha ≤ corte(k)', () => {
    const r = crearAleatorio(2);
    for (let i = 0; i < 5000; i++) {
      const d = r.fecha(2000, 2040);
      const f = r.fecha(2000, 2045);
      if (f < d) continue;
      const k = periodoDeFecha(d, f);
      expect(k).toBeGreaterThanOrEqual(1);
      expect(f <= fechaCorte(d, k)).toBe(true);
      if (f !== d) expect(fechaCorte(d, k - 1) < f).toBe(true);
    }
  });
});

describe('diasEntre / sumarDias', () => {
  it('cuenta días calendario', () => {
    expect(diasEntre('2026-04-15', '2026-05-20')).toBe(35);
    expect(diasEntre('2026-02-28', '2026-03-01')).toBe(1);
    expect(diasEntre('2024-02-28', '2024-03-01')).toBe(2);
    expect(diasEntre('2026-01-01', '2027-01-01')).toBe(365);
    expect(diasEntre('2026-05-20', '2026-04-15')).toBe(-35);
    expect(diasEntre('1970-01-01', '1970-01-01')).toBe(0);
  });

  it('suma días cruzando meses y años', () => {
    expect(sumarDias('2026-12-31', 1)).toBe('2027-01-01');
    expect(sumarDias('2024-02-28', 1)).toBe('2024-02-29');
    expect(sumarDias('2026-03-01', -1)).toBe('2026-02-28');
    expect(sumarDias('2026-01-15', 0)).toBe('2026-01-15');
  });

  it('propiedad: sumarDias y diasEntre son inversas, y sumar 1 da el día siguiente', () => {
    const r = crearAleatorio(5);
    for (let i = 0; i < 5000; i++) {
      const f = r.fecha(1960, 2080);
      const n = r.entero(-15_000, 15_000);
      expect(diasEntre(f, sumarDias(f, n))).toBe(n);
      const siguiente = sumarDias(f, 1);
      const p = parseFecha(f);
      const s = parseFecha(siguiente);
      if (p.dia < diasEnMes(p.anio, p.mes)) expect(s).toEqual({ ...p, dia: p.dia + 1 });
      else expect(s.dia).toBe(1);
    }
  });
});

describe('dias30E360', () => {
  it('cuenta 30 días por mes', () => {
    expect(dias30E360('2026-01-15', '2026-02-15')).toBe(30);
    expect(dias30E360('2026-01-15', '2027-01-15')).toBe(360);
    expect(dias30E360('2026-01-12', '2026-01-15')).toBe(3);
    expect(dias30E360('2026-01-15', '2026-01-15')).toBe(0);
  });

  it('trata el 31 como 30', () => {
    expect(dias30E360('2026-01-30', '2026-01-31')).toBe(0);
    expect(dias30E360('2026-01-31', '2026-03-31')).toBe(60);
  });

  it('febrero corto da menos de 30 (por eso la cancelación usa 30 fijo el día de corte)', () => {
    expect(dias30E360('2026-01-31', '2026-02-28')).toBe(28);
  });

  it('rechaza rangos invertidos', () => {
    expect(() => dias30E360('2026-02-01', '2026-01-31')).toThrow(ErrorNegocio);
  });
});
