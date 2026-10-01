// Los números del estado de cuenta que recibe el cliente.
import { aplicarLiquidacion, aplicarPago, reversarPago, type Movimiento, type Prestamo } from '@prestamos/core';
import { describe, expect, it } from 'vitest';
import type { PrestamoCompleto } from '../src/datos/cartera.ts';
import { armarEstadoDeCuenta } from '../src/datos/estadoCuenta.ts';
import { conEstado } from '../src/datos/reportes.ts';

const P: Prestamo = {
  capital: 2_500_000,
  tasaMensualBp: 500,
  fechaDesembolso: '2026-05-03',
  plazoMeses: null,
  socios: [
    { socioId: 'a', tasaBp: 300, aporteCapital: 1_500_000 },
    { socioId: 'c', tasaBp: 200, aporteCapital: 1_000_000 },
  ],
};

function completo(movimientos: Movimiento[], estado: 'activo' | 'pagado' = 'activo'): PrestamoCompleto {
  return {
    fila: {
      id: 'p1',
      cliente_id: 'cli',
      cliente_nombre: 'Jorge Ramírez',
      cliente_documento: '1002',
      capital_inicial: P.capital,
      tasa_mensual_bp: P.tasaMensualBp,
      fecha_desembolso: P.fechaDesembolso,
      plazo_meses: null,
      estado,
      notas: null,
      created_at: '',
      socios: [],
    },
    // `pagos` solo aporta el medio de cada movimiento.
    pagos: movimientos.map((m, i) => ({ id: m.id, medio: i === 0 ? 'Nequi' : 'Efectivo' }) as PrestamoCompleto['pagos'][number]),
    prestamo: P,
    movimientos,
  };
}

function pagar(movimientos: Movimiento[], fecha: string, monto: number): Movimiento[] {
  return [...movimientos, { ...aplicarPago(P, movimientos, { fecha, monto }, '2026-12-31'), id: `m${movimientos.length + 1}` }];
}

describe('armarEstadoDeCuenta', () => {
  // Dos meses de interés (125.000 c/u) y un pago de 625.000: 125.000 de interés + 500.000 de capital.
  let libro = pagar([], '2026-06-03', 125_000);
  libro = pagar(libro, '2026-07-03', 125_000);
  libro = pagar(libro, '2026-08-03', 625_000);
  const hoy = '2026-10-01';
  const ec = armarEstadoDeCuenta(conEstado(completo(libro), hoy), hoy);

  it('lleva los datos del cliente y del préstamo', () => {
    expect(ec.cliente).toEqual({ nombre: 'Jorge Ramírez', documento: '1002' });
    expect(ec.prestamo).toMatchObject({ capital: 2_500_000, tasaMensualBp: 500, fechaDesembolso: '2026-05-03', cancelado: false });
  });

  it('cada pago muestra cuánto fue a interés, cuánto a capital y el capital que quedó', () => {
    expect(ec.pagos.map((p) => [p.fecha, p.monto, p.aInteres, p.aCapital, p.saldoDespues])).toEqual([
      ['2026-06-03', 125_000, 125_000, 0, 2_500_000],
      ['2026-07-03', 125_000, 125_000, 0, 2_500_000],
      ['2026-08-03', 625_000, 125_000, 500_000, 2_000_000],
    ]);
    expect(ec.pagos[0]!.medio).toBe('Nequi');
  });

  it('los totales cuadran con la suma de los pagos', () => {
    expect(ec.capitalAbonado).toBe(500_000);
    expect(ec.interesPagado).toBe(375_000);
    expect(ec.totalPagado).toBe(875_000);
    expect(ec.totalPagado).toBe(ec.pagos.reduce((s, p) => s + p.monto, 0));
    expect(ec.capitalPendiente).toBe(2_000_000);
    expect(ec.capitalPendiente).toBe(ec.pagos.at(-1)!.saldoDespues);
    expect(ec.capitalPendiente + ec.capitalAbonado).toBe(P.capital);
  });

  it('informa lo atrasado, el próximo pago y lo que cuesta cancelar hoy', () => {
    // El corte del 3-sep (100.000 sobre 2.000.000) no se pagó.
    expect(ec.interesVencido).toBe(100_000);
    expect(ec.mesesAtrasados).toBe(1);
    expect(ec.proximoPago).toEqual({ fecha: '2026-10-03', monto: 100_000, incluyeCapital: false });
    // 1-oct: 28 días del mes en curso (3-sep → 1-oct) = 2.000.000 · 5 % · 28/30 = 93.333.
    expect(ec.paraCancelarHoy).toEqual({ interes: 100_000 + 93_333, capital: 2_000_000, total: 2_193_333 });
  });

  it('el mes a mes muestra sobre qué capital se calculó cada interés', () => {
    expect(ec.meses.map((m) => [m.numero, m.fechaCorte, m.saldoBase, m.interes, m.pagado, m.estado])).toEqual([
      [1, '2026-06-03', 2_500_000, 125_000, 125_000, 'pagado'],
      [2, '2026-07-03', 2_500_000, 125_000, 125_000, 'pagado'],
      [3, '2026-08-03', 2_500_000, 125_000, 125_000, 'pagado'],
      [4, '2026-09-03', 2_000_000, 100_000, 0, 'vencido'],
      [5, '2026-10-03', 2_000_000, 100_000, 0, 'curso'],
    ]);
  });

  it('un pago reversado no aparece: el cliente solo ve los pagos vigentes', () => {
    const conError = pagar(libro, '2026-09-10', 300_000);
    const reverso = { ...reversarPago(P, conError, 'm4', '2026-09-11'), id: 'm5' };
    const corregido = armarEstadoDeCuenta(conEstado(completo([...conError, reverso]), hoy), hoy);
    expect(corregido.pagos).toHaveLength(3);
    expect(corregido.capitalPendiente).toBe(2_000_000);
    expect(corregido.totalPagado).toBe(875_000);
  });

  it('un préstamo cancelado no tiene próximo pago ni valor de cancelación, y no lista meses posteriores', () => {
    const total = 2_000_000 + 100_000 + 93_333;
    const liquidado = [...libro, { ...aplicarLiquidacion(P, libro, '2026-10-01', '2026-10-01', total), id: 'm4' }];
    const despues = '2027-01-15';
    const fin = armarEstadoDeCuenta(conEstado(completo(liquidado, 'pagado'), despues), despues);
    expect(fin.prestamo.cancelado).toBe(true);
    expect(fin.capitalPendiente).toBe(0);
    expect(fin.proximoPago).toBeNull();
    expect(fin.paraCancelarHoy).toBeNull();
    expect(fin.pagos.at(-1)).toMatchObject({ tipo: 'liquidacion', monto: total, aCapital: 2_000_000, saldoDespues: 0 });
    expect(fin.meses.map((m) => m.numero)).toEqual([1, 2, 3, 4, 5]);
    expect(fin.totalPagado).toBe(875_000 + total);
  });

  it('con el plazo cumplido, el próximo pago avisa que incluye el capital', () => {
    const conPlazo = { ...completo(libro), prestamo: { ...P, plazoMeses: 4 } };
    const r = armarEstadoDeCuenta(conEstado(conPlazo, hoy), hoy);
    // Mes 5 ≥ plazo 4: 100.000 de interés + 2.000.000 de capital.
    expect(r.proximoPago).toEqual({ fecha: '2026-10-03', monto: 2_100_000, incluyeCapital: true });
  });

  it('sin pagos: debe todo el capital y la lista de pagos está vacía', () => {
    const nuevo = armarEstadoDeCuenta(conEstado(completo([]), '2026-05-10'), '2026-05-10');
    expect(nuevo.pagos).toEqual([]);
    expect(nuevo.capitalPendiente).toBe(2_500_000);
    expect(nuevo.totalPagado).toBe(0);
    // 7 días del primer mes: 2.500.000 · 5 % · 7/30 = 29.167.
    expect(nuevo.paraCancelarHoy).toEqual({ interes: 29_167, capital: 2_500_000, total: 2_529_167 });
  });
});
