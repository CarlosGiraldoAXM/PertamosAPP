import { describe, expect, it } from 'vitest';
import { ErrorNegocio } from '../src/errores.ts';
import { fechaCorte } from '../src/fechas.ts';
import { generarPlanDePagos, proyectarCortes, type CondicionesPrestamo } from '../src/plan.ts';
import { crearAleatorio } from './aleatorio.ts';

const base: CondicionesPrestamo = {
  capital: 1_000_000,
  tasaMensualBp: 300,
  fechaDesembolso: '2026-01-31',
  plazoMeses: null,
};

describe('generarPlanDePagos — solo interés', () => {
  it('sin plazo y con interés redondo: cobra 30.000 cada mes y el capital no baja', () => {
    const plan = generarPlanDePagos(base, { horizonteMeses: 3 });
    expect(plan.cortes).toEqual([
      { numero: 1, fechaInicio: '2026-01-31', fechaCorte: '2026-02-28', saldoInicial: 1_000_000, interesExacto: 30_000, cuotaACobrar: 30_000, abonoCapital: 0, saldoFinal: 1_000_000 },
      { numero: 2, fechaInicio: '2026-02-28', fechaCorte: '2026-03-31', saldoInicial: 1_000_000, interesExacto: 30_000, cuotaACobrar: 30_000, abonoCapital: 0, saldoFinal: 1_000_000 },
      { numero: 3, fechaInicio: '2026-03-31', fechaCorte: '2026-04-30', saldoInicial: 1_000_000, interesExacto: 30_000, cuotaACobrar: 30_000, abonoCapital: 0, saldoFinal: 1_000_000 },
    ]);
    expect(plan.totalInteres).toBe(90_000);
    expect(plan.totalCapital).toBe(0);
    expect(plan.saldoAlFinal).toBe(1_000_000);
  });

  it('sin plazo proyecta 12 meses por defecto', () => {
    expect(generarPlanDePagos(base).cortes).toHaveLength(12);
  });

  it('redondea la cuota a los mil y el excedente baja el capital', () => {
    const plan = generarPlanDePagos({ ...base, capital: 1_234_567, fechaDesembolso: '2026-03-10' }, { horizonteMeses: 2 });
    const [c1, c2] = plan.cortes;
    expect(c1).toMatchObject({ fechaCorte: '2026-04-10', saldoInicial: 1_234_567, interesExacto: 37_037, cuotaACobrar: 38_000, abonoCapital: 963, saldoFinal: 1_233_604 });
    // 1.233.604 · 3 % = 37.008,12
    expect(c2).toMatchObject({ fechaCorte: '2026-05-10', saldoInicial: 1_233_604, interesExacto: 37_008, cuotaACobrar: 38_000, abonoCapital: 992, saldoFinal: 1_232_612 });
    expect(plan.totalCapital).toBe(1_955);
    expect(plan.saldoAlFinal).toBe(1_232_612);
  });

  it('con plazo, el último corte cobra interés + todo el capital exacto (sin redondeo)', () => {
    const plan = generarPlanDePagos({ ...base, capital: 1_234_567, plazoMeses: 3 });
    expect(plan.cortes).toHaveLength(3);
    const ultimo = plan.cortes[2]!;
    expect(ultimo.cuotaACobrar).toBe(ultimo.interesExacto + ultimo.saldoInicial);
    expect(ultimo.saldoFinal).toBe(0);
    expect(plan.totalCapital).toBe(1_234_567);
    expect(plan.saldoAlFinal).toBe(0);
    expect(plan.totalACobrar).toBe(plan.totalInteres + 1_234_567);
  });

  it('el redondeo nunca cobra más que interés + saldo', () => {
    // Saldo 500, interés 15 → techoMil sería 1.000 pero solo se deben 515.
    const cortes = proyectarCortes(base, 500, 5, 3);
    expect(cortes).toHaveLength(1);
    expect(cortes[0]).toMatchObject({ numero: 5, interesExacto: 15, cuotaACobrar: 515, abonoCapital: 500, saldoFinal: 0 });
  });

  it('proyectarCortes arranca en el corte pedido, con sus fechas', () => {
    const cortes = proyectarCortes(base, 800_000, 7, 2);
    expect(cortes.map((c) => [c.numero, c.fechaInicio, c.fechaCorte])).toEqual([
      [7, '2026-07-31', '2026-08-31'],
      [8, '2026-08-31', '2026-09-30'],
    ]);
    expect(cortes[0]!.interesExacto).toBe(24_000);
  });

  it('con el plazo ya vencido, el siguiente corte cobra todo el capital', () => {
    const cortes = proyectarCortes({ ...base, plazoMeses: 3 }, 400_000, 6, 12);
    expect(cortes).toHaveLength(1);
    expect(cortes[0]).toMatchObject({ numero: 6, cuotaACobrar: 412_000, saldoFinal: 0 });
  });

  it.each<[string, Partial<CondicionesPrestamo>]>([
    ['capital 0', { capital: 0 }],
    ['capital fraccionario', { capital: 1000.5 }],
    ['tasa 0', { tasaMensualBp: 0 }],
    ['tasa fraccionaria', { tasaMensualBp: 2.5 }],
    ['fecha inválida', { fechaDesembolso: '2026-02-30' }],
    ['plazo 0', { plazoMeses: 0 }],
    ['plazo fraccionario', { plazoMeses: 1.5 }],
  ])('rechaza %s', (_, cambio) => {
    expect(() => generarPlanDePagos({ ...base, ...cambio })).toThrow(ErrorNegocio);
  });

  it('propiedad: el plan cuadra al peso', () => {
    const r = crearAleatorio(4);
    for (let i = 0; i < 2_000; i++) {
      const c: CondicionesPrestamo = {
        capital: r.entero(1, 500_000_000),
        tasaMensualBp: r.entero(1, 1_000),
        fechaDesembolso: r.fecha(2020, 2035),
        plazoMeses: r.siguiente() < 0.5 ? null : r.entero(1, 48),
      };
      const plan = generarPlanDePagos(c, { horizonteMeses: r.entero(1, 36) });

      expect(plan.totalCapital + plan.saldoAlFinal).toBe(c.capital);
      if (c.plazoMeses !== null) expect(plan.saldoAlFinal).toBe(0);

      let saldo = c.capital;
      plan.cortes.forEach((corte, j) => {
        expect(corte.numero).toBe(j + 1);
        expect(corte.fechaCorte).toBe(fechaCorte(c.fechaDesembolso, j + 1));
        expect(corte.saldoInicial).toBe(saldo);
        expect(corte.cuotaACobrar).toBe(corte.interesExacto + corte.abonoCapital);
        expect(corte.saldoFinal).toBe(saldo - corte.abonoCapital);
        expect(corte.saldoFinal).toBeGreaterThanOrEqual(0);
        const esCorteDeCapital = c.plazoMeses !== null && corte.numero === c.plazoMeses;
        if (!esCorteDeCapital && corte.saldoFinal > 0) {
          // Cuota intermedia: múltiplo de mil y el redondeo agrega menos de mil.
          expect(corte.cuotaACobrar % 1000).toBe(0);
          expect(corte.abonoCapital).toBeLessThan(1000);
        }
        saldo = corte.saldoFinal;
      });
    }
  });
});
