import { describe, expect, it } from 'vitest';
import { estadoPrestamo, type EstadoFinanciero } from '../src/estado.ts';
import { sumarDias } from '../src/fechas.ts';
import type { Movimiento } from '../src/libro.ts';
import { aplicarLiquidacion, aplicarPago, cotizarLiquidacion, reversarPago } from '../src/pagos.ts';
import type { ParticipacionSocio, Prestamo } from '../src/socios.ts';
import { crearAleatorio } from './aleatorio.ts';

function invariantes(p: Prestamo, e: EstadoFinanciero): void {
  expect(e.saldoCapital).toBe(p.capital - e.capitalPagado);
  expect(e.saldoCapital).toBeGreaterThanOrEqual(0);
  expect(e.interesVencidoPendiente).toBeGreaterThanOrEqual(0);
  expect(e.socios.reduce((s, x) => s + x.capitalDevuelto, 0)).toBe(e.capitalPagado);
  expect(e.socios.reduce((s, x) => s + x.interesCobrado, 0)).toBe(e.interesPagado);
  for (const s of e.socios) {
    expect(s.capitalDevuelto).toBeGreaterThanOrEqual(0);
    expect(s.capitalDevuelto).toBeLessThanOrEqual(s.aporteCapital);
    if (e.saldoCapital === 0) expect(s.capitalPendiente).toBe(0);
  }
  for (const periodo of e.periodos) expect(periodo.pagado).toBeLessThanOrEqual(periodo.interes);
}

describe('simulación aleatoria de préstamos', () => {
  it('propiedad: el libro cuadra al peso después de cualquier secuencia de pagos, liquidaciones y reversos', () => {
    const r = crearAleatorio(7);
    let operaciones = 0;
    for (let caso = 0; caso < 300; caso++) {
      const capital = r.entero(100_000, 100_000_000);
      const tasa = r.entero(50, 1_000);
      const n = r.entero(1, 3);
      const socios: ParticipacionSocio[] = [];
      let tasaRestante = tasa;
      let capitalRestante = capital;
      for (let i = 0; i < n; i++) {
        const ultimo = i === n - 1;
        const t = ultimo ? tasaRestante : r.entero(0, tasaRestante);
        const c = ultimo ? capitalRestante : r.entero(0, capitalRestante);
        socios.push({ socioId: `S${i}`, tasaBp: t, aporteCapital: c });
        tasaRestante -= t;
        capitalRestante -= c;
      }
      const p: Prestamo = {
        capital,
        tasaMensualBp: tasa,
        fechaDesembolso: r.fecha(2020, 2030),
        plazoMeses: r.siguiente() < 0.5 ? null : r.entero(1, 24),
        socios,
      };

      let libro: Movimiento[] = [];
      let hoy = p.fechaDesembolso;
      const registrar = (m: Omit<Movimiento, 'id'>) => {
        libro = [...libro, { ...m, id: `m${libro.length + 1}` }];
        operaciones++;
      };

      for (let paso = 0; paso < 25; paso++) {
        hoy = sumarDias(hoy, r.entero(0, 45));
        const e = estadoPrestamo(p, libro, hoy);
        const op = r.siguiente();

        if (op < 0.6 && !e.cancelado) {
          const enCurso = e.proximoCorte && e.proximoCorte.numero === e.periodoActual ? e.proximoCorte.interesExacto : 0;
          const maximo = e.interesVencidoPendiente + enCurso + e.saldoCapital;
          const monto = r.siguiente() < 0.5
            ? Math.min(maximo, e.interesVencidoPendiente + r.entero(0, enCurso + 5_000))
            : r.entero(e.interesVencidoPendiente, maximo);
          if (monto > 0) {
            const m = aplicarPago(p, libro, { fecha: hoy, monto }, hoy);
            expect(m.aplicaciones.reduce((s, a) => s + a.aInteres + a.aCapital, 0)).toBe(monto);
            registrar(m);
          }
        } else if (op < 0.68 && !e.cancelado) {
          const c = cotizarLiquidacion(p, libro, hoy, hoy);
          registrar(aplicarLiquidacion(p, libro, hoy, hoy, c.total));
          expect(estadoPrestamo(p, libro, hoy).cancelado).toBe(true);
        } else if (op < 0.85) {
          const reversados = new Set(libro.map((m) => m.reversaDe));
          const efectivos = libro.filter((m) => m.tipo !== 'reverso' && !reversados.has(m.id));
          const ultimo = efectivos[efectivos.length - 1];
          if (ultimo) {
            const sinUltimo = libro.filter((m) => m !== ultimo);
            registrar(reversarPago(p, libro, ultimo.id, hoy));
            // Reversar = como si el movimiento nunca hubiera existido.
            expect(estadoPrestamo(p, libro, hoy)).toEqual(estadoPrestamo(p, sinUltimo, hoy));
          }
        }

        invariantes(p, estadoPrestamo(p, libro, hoy));
      }
    }
    expect(operaciones).toBeGreaterThan(3_000);
  });
});
