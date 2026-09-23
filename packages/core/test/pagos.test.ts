import { describe, expect, it } from 'vitest';
import { ErrorNegocio } from '../src/errores.ts';
import { estadoPrestamo } from '../src/estado.ts';
import type { Movimiento, MovimientoNuevo } from '../src/libro.ts';
import { aplicarLiquidacion, aplicarPago, cotizarLiquidacion, reversarPago } from '../src/pagos.ts';
import { validarPrestamo, type Prestamo } from '../src/socios.ts';

// $1.000.000 al 3 % mensual: socio A se queda 1 % y puso $400.000; socio B 2 % y $600.000.
const P: Prestamo = {
  capital: 1_000_000,
  tasaMensualBp: 300,
  fechaDesembolso: '2026-01-15',
  plazoMeses: null,
  socios: [
    { socioId: 'A', tasaBp: 100, aporteCapital: 400_000 },
    { socioId: 'B', tasaBp: 200, aporteCapital: 600_000 },
  ],
};

function registrar(libro: Movimiento[], nuevo: MovimientoNuevo): Movimiento[] {
  return [...libro, { ...nuevo, id: `m${libro.length + 1}` }];
}

function codigo(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof ErrorNegocio) return e.codigo;
    throw e;
  }
  throw new Error('Se esperaba un ErrorNegocio');
}

describe('validarPrestamo', () => {
  it('acepta socios que cuadran', () => {
    expect(() => validarPrestamo(P)).not.toThrow();
  });

  it('rechaza tasas de socios que no suman la tasa del préstamo', () => {
    expect(codigo(() => validarPrestamo({ ...P, socios: [{ socioId: 'A', tasaBp: 100, aporteCapital: 1_000_000 }] }))).toBe(
      'SOCIOS_TASA_NO_CUADRA',
    );
  });

  it('rechaza aportes que no suman el capital', () => {
    expect(
      codigo(() =>
        validarPrestamo({
          ...P,
          socios: [
            { socioId: 'A', tasaBp: 100, aporteCapital: 400_000 },
            { socioId: 'B', tasaBp: 200, aporteCapital: 500_000 },
          ],
        }),
      ),
    ).toBe('SOCIOS_CAPITAL_NO_CUADRA');
  });

  it('rechaza socios repetidos o ausentes', () => {
    expect(codigo(() => validarPrestamo({ ...P, socios: [] }))).toBe('SOCIOS_INVALIDOS');
    expect(
      codigo(() =>
        validarPrestamo({
          ...P,
          socios: [
            { socioId: 'A', tasaBp: 100, aporteCapital: 400_000 },
            { socioId: 'A', tasaBp: 200, aporteCapital: 600_000 },
          ],
        }),
      ),
    ).toBe('SOCIOS_INVALIDOS');
  });

  it('permite que un socio no ponga capital', () => {
    expect(() =>
      validarPrestamo({
        ...P,
        socios: [
          { socioId: 'A', tasaBp: 100, aporteCapital: 0 },
          { socioId: 'B', tasaBp: 200, aporteCapital: 1_000_000 },
        ],
      }),
    ).not.toThrow();
  });
});

describe('préstamo de punta a punta', () => {
  // 1. Paga el interés del primer mes el día del corte.
  let libro = registrar([], aplicarPago(P, [], { fecha: '2026-02-15', monto: 30_000 }, '2026-02-15'));

  it('1. el pago del mes va todo a interés, repartido 1 % / 2 %', () => {
    expect(libro[0]!.aplicaciones).toEqual([
      {
        periodo: 1,
        aInteres: 30_000,
        aCapital: 0,
        reparto: [
          { socioId: 'A', interes: 10_000, capital: 0 },
          { socioId: 'B', interes: 20_000, capital: 0 },
        ],
      },
    ]);
  });

  // 2. Tres días antes del corte paga el mes completo + abona $200.000.
  const libro2 = registrar(libro, aplicarPago(P, libro, { fecha: '2026-03-12', monto: 230_000 }, '2026-03-12'));

  it('2. pagar antes del corte cubre el mes completo; el resto baja capital por aportes', () => {
    expect(libro2[1]!.aplicaciones).toEqual([
      {
        periodo: 2,
        aInteres: 30_000,
        aCapital: 0,
        reparto: [
          { socioId: 'A', interes: 10_000, capital: 0 },
          { socioId: 'B', interes: 20_000, capital: 0 },
        ],
      },
      {
        periodo: null,
        aInteres: 0,
        aCapital: 200_000,
        reparto: [
          { socioId: 'A', interes: 0, capital: 80_000 },
          { socioId: 'B', interes: 0, capital: 120_000 },
        ],
      },
    ]);
  });

  it('3. el abono baja el interés desde el corte siguiente', () => {
    const e = estadoPrestamo(P, libro2, '2026-03-20');
    expect(e.saldoCapital).toBe(800_000);
    expect(e.capitalPagado).toBe(200_000);
    expect(e.interesPagado).toBe(60_000);
    expect(e.periodoActual).toBe(3);
    expect(e.interesVencidoPendiente).toBe(0);
    expect(e.diasAtraso).toBe(0);
    expect(e.proximoCorte).toEqual({ numero: 3, fecha: '2026-04-15', interesExacto: 24_000, cuotaACobrar: 24_000 });
    expect(e.periodos.map((p) => [p.numero, p.saldoBase, p.interes, p.pendiente, p.vencido])).toEqual([
      [1, 1_000_000, 30_000, 0, true],
      [2, 1_000_000, 30_000, 0, true],
      [3, 800_000, 24_000, 24_000, false],
    ]);
    expect(e.proyeccion).toHaveLength(12);
    expect(e.interesProyectado).toBe(12 * 24_000);
    expect(e.totalProyectadoAlFinal).toBeNull();
    expect(e.socios).toEqual([
      { socioId: 'A', tasaBp: 100, aporteCapital: 400_000, interesCobrado: 20_000, capitalDevuelto: 80_000, capitalPendiente: 320_000, interesVencidoPendiente: 0, interesProyectado: 96_000 },
      { socioId: 'B', tasaBp: 200, aporteCapital: 600_000, interesCobrado: 40_000, capitalDevuelto: 120_000, capitalPendiente: 480_000, interesVencidoPendiente: 0, interesProyectado: 192_000 },
    ]);
  });

  it('4. dos meses sin pagar: atraso de 35 días, sin mora', () => {
    const e = estadoPrestamo(P, libro2, '2026-05-20');
    expect(e.interesVencidoPendiente).toBe(48_000);
    expect(e.periodosAtrasados).toBe(2);
    expect(e.diasAtraso).toBe(35);
    expect(e.aCobrarHoy).toEqual({ interesExacto: 48_000, cuotaACobrar: 48_000 });
    expect(e.proximoCorte).toMatchObject({ numero: 5, fecha: '2026-06-15', interesExacto: 24_000 });
    expect(e.socios.map((s) => s.interesVencidoPendiente)).toEqual([16_000, 32_000]);
  });

  it('5. un pago que no cubre el interés vencido se rechaza', () => {
    expect(codigo(() => aplicarPago(P, libro2, { fecha: '2026-05-20', monto: 40_000 }, '2026-05-20'))).toBe('PAGO_INSUFICIENTE');
  });

  const libro3 = registrar(libro2, aplicarPago(P, libro2, { fecha: '2026-05-20', monto: 50_000 }, '2026-05-20'));

  it('6. cubre lo vencido del más antiguo al más nuevo y el sobrante va al mes en curso', () => {
    expect(libro3[2]!.aplicaciones.map((a) => [a.periodo, a.aInteres, a.aCapital])).toEqual([
      [3, 24_000, 0],
      [4, 24_000, 0],
      [5, 2_000, 0],
    ]);
    expect(libro3[2]!.aplicaciones[2]!.reparto.map((r) => r.interes)).toEqual([666, 1_334]);
    const e = estadoPrestamo(P, libro3, '2026-05-20');
    expect(e.interesVencidoPendiente).toBe(0);
    expect(e.proximoCorte).toMatchObject({ numero: 5, interesExacto: 22_000, cuotaACobrar: 22_000 });
  });

  it('7. cotiza la cancelación total con interés proporcional hasta el día', () => {
    const c = cotizarLiquidacion(P, libro3, '2026-06-05', '2026-06-05');
    // Período 5 va del 15-may al 15-jun: 20 días → 800.000 · 3 % · 20/30 = 16.000, menos 2.000 ya pagados.
    expect(c).toMatchObject({ periodo: 5, interesVencido: 0, diasEnCurso: 20, interesEnCurso: 14_000, capital: 800_000, total: 814_000 });
  });

  it('8. la liquidación exige el monto cotizado', () => {
    expect(codigo(() => aplicarLiquidacion(P, libro3, '2026-06-05', '2026-06-05', 813_000))).toBe('COTIZACION_DESACTUALIZADA');
  });

  const libro4 = registrar(libro3, aplicarLiquidacion(P, libro3, '2026-06-05', '2026-06-05', 814_000));

  it('9. después de liquidar: cancelado, cada socio recuperó su aporte exacto y no queda interés', () => {
    const e = estadoPrestamo(P, libro4, '2026-08-01');
    expect(e.cancelado).toBe(true);
    expect(e.saldoCapital).toBe(0);
    expect(e.interesVencidoPendiente).toBe(0);
    expect(e.proximoCorte).toBeNull();
    expect(e.proyeccion).toEqual([]);
    expect(e.interesPagado).toBe(30_000 + 30_000 + 24_000 + 24_000 + 16_000);
    expect(e.periodos.find((p) => p.numero === 5)).toMatchObject({ interes: 16_000, pagado: 16_000, pendiente: 0 });
    expect(e.socios.map((s) => [s.capitalDevuelto, s.capitalPendiente])).toEqual([
      [400_000, 0],
      [600_000, 0],
    ]);
    expect(codigo(() => aplicarPago(P, libro4, { fecha: '2026-08-01', monto: 1_000 }, '2026-08-01'))).toBe('PRESTAMO_CANCELADO');
  });

  it('10. el reverso deja el préstamo exactamente como antes del movimiento', () => {
    const libro5 = registrar(libro4, reversarPago(P, libro4, 'm4', '2026-06-06'));
    expect(libro5[4]).toMatchObject({ tipo: 'reverso', monto: -814_000, reversaDe: 'm4' });
    expect(estadoPrestamo(P, libro5, '2026-06-10')).toEqual(estadoPrestamo(P, libro3, '2026-06-10'));
  });

  it('11. solo se reversa el último movimiento efectivo, una sola vez, y nunca un reverso', () => {
    expect(codigo(() => reversarPago(P, libro4, 'm3', '2026-06-06'))).toBe('REVERSO_NO_ES_ULTIMO');
    const libro5 = registrar(libro4, reversarPago(P, libro4, 'm4', '2026-06-06'));
    expect(codigo(() => reversarPago(P, libro5, 'm4', '2026-06-06'))).toBe('REVERSO_INVALIDO');
    expect(codigo(() => reversarPago(P, libro5, 'm5', '2026-06-06'))).toBe('REVERSO_INVALIDO');
    // Tras reversar m4, el último efectivo es m3.
    expect(() => reversarPago(P, libro5, 'm3', '2026-06-06')).not.toThrow();
    expect(codigo(() => reversarPago(P, libro5, 'nope', '2026-06-06'))).toBe('MOVIMIENTO_NO_EXISTE');
  });

  it('12. valida fechas de los pagos', () => {
    expect(codigo(() => aplicarPago(P, libro2, { fecha: '2026-03-25', monto: 1_000 }, '2026-03-20'))).toBe('FECHA_FUTURA');
    expect(codigo(() => aplicarPago(P, libro2, { fecha: '2026-03-01', monto: 1_000 }, '2026-03-20'))).toBe('FECHA_ANTERIOR_A_ULTIMO_PAGO');
    expect(codigo(() => aplicarPago(P, [], { fecha: '2026-01-10', monto: 1_000 }, '2026-03-20'))).toBe('FECHA_ANTES_DE_DESEMBOLSO');
  });

  it('13. un pago mayor que toda la deuda se rechaza', () => {
    // Al 12-mar debe 30.000 del mes en curso + 1.000.000 de capital.
    expect(codigo(() => aplicarPago(P, libro, { fecha: '2026-03-12', monto: 1_030_001 }, '2026-03-12'))).toBe('PAGO_EXCEDE_DEUDA');
    expect(() => aplicarPago(P, libro, { fecha: '2026-03-12', monto: 1_030_000 }, '2026-03-12')).not.toThrow();
  });

  it('14. pagar el día del corte no adelanta el mes siguiente: el resto va a capital', () => {
    const nuevo = aplicarPago(P, libro, { fecha: '2026-03-15', monto: 50_000 }, '2026-03-15');
    expect(nuevo.aplicaciones.map((a) => [a.periodo, a.aInteres, a.aCapital])).toEqual([
      [2, 30_000, 0],
      [null, 0, 20_000],
    ]);
  });

  it('15. liquidar el día del desembolso no cobra interés', () => {
    const c = cotizarLiquidacion(P, [], '2026-01-15', '2026-01-15');
    expect(c).toMatchObject({ interesEnCurso: 0, diasEnCurso: 0, total: 1_000_000 });
  });

  it('16. liquidar el día de corte cobra el mes completo como vencido', () => {
    const c = cotizarLiquidacion(P, libro, '2026-03-15', '2026-03-15');
    expect(c).toMatchObject({ periodo: 2, interesVencido: 30_000, interesEnCurso: 0, total: 1_030_000 });
  });

  it('16b. un abono el día del desembolso paga el primer mes completo y baja el interés desde el segundo', () => {
    const l = registrar([], aplicarPago(P, [], { fecha: '2026-01-15', monto: 530_000 }, '2026-01-15'));
    expect(l[0]!.aplicaciones.map((a) => [a.periodo, a.aInteres, a.aCapital])).toEqual([
      [1, 30_000, 0],
      [null, 0, 500_000],
    ]);
    const e = estadoPrestamo(P, l, '2026-02-20');
    expect(e.periodos.map((p) => [p.numero, p.saldoBase, p.interes, p.pagado])).toEqual([
      [1, 1_000_000, 30_000, 30_000],
      [2, 500_000, 15_000, 0],
    ]);
  });

  it('17. el excedente del redondeo a los mil se imputa a capital', () => {
    const Q: Prestamo = { ...P, capital: 1_234_567, socios: [{ socioId: 'A', tasaBp: 300, aporteCapital: 1_234_567 }] };
    const e0 = estadoPrestamo(Q, [], '2026-02-01');
    expect(e0.proximoCorte).toMatchObject({ interesExacto: 37_037, cuotaACobrar: 38_000 });
    const m = aplicarPago(Q, [], { fecha: '2026-02-15', monto: 38_000 }, '2026-02-15');
    expect(m.aplicaciones.map((a) => [a.periodo, a.aInteres, a.aCapital])).toEqual([
      [1, 37_037, 0],
      [null, 0, 963],
    ]);
  });
});

describe('préstamo con plazo', () => {
  const C: Prestamo = { ...P, plazoMeses: 3 };
  const libro = registrar([], aplicarPago(C, [], { fecha: '2026-02-15', monto: 30_000 }, '2026-02-15'));

  it('proyecta hasta el plazo y calcula el total al finalizar', () => {
    const e = estadoPrestamo(C, libro, '2026-02-20');
    expect(e.proyeccion.map((c) => [c.numero, c.interesExacto, c.cuotaACobrar])).toEqual([
      [2, 30_000, 30_000],
      [3, 30_000, 1_030_000],
    ]);
    expect(e.totalProyectadoAlFinal).toBe(1_000_000 + 3 * 30_000);
    expect(e.plazoVencido).toBe(false);
  });

  it('marca el plazo vencido si queda capital después del último corte', () => {
    const e = estadoPrestamo(C, libro, '2026-04-20');
    expect(e.plazoVencido).toBe(true);
    expect(e.interesVencidoPendiente).toBe(60_000);
    // El interés sigue corriendo mientras quede capital.
    expect(e.proximoCorte).toMatchObject({ numero: 4, cuotaACobrar: 1_030_000 });
  });
});

describe('libro inconsistente', () => {
  it('detecta aplicaciones que no suman el monto', () => {
    const malo: Movimiento[] = [
      { id: 'x', tipo: 'pago', fecha: '2026-02-15', monto: 30_000, reversaDe: null, aplicaciones: [{ periodo: 1, aInteres: 29_000, aCapital: 0, reparto: [{ socioId: 'A', interes: 29_000, capital: 0 }] }] },
    ];
    expect(codigo(() => estadoPrestamo(P, malo, '2026-03-01'))).toBe('LIBRO_INCONSISTENTE');
  });

  it('detecta un reparto entre socios que no cuadra', () => {
    const malo: Movimiento[] = [
      { id: 'x', tipo: 'pago', fecha: '2026-02-15', monto: 30_000, reversaDe: null, aplicaciones: [{ periodo: 1, aInteres: 30_000, aCapital: 0, reparto: [{ socioId: 'A', interes: 10_000, capital: 0 }] }] },
    ];
    expect(codigo(() => estadoPrestamo(P, malo, '2026-03-01'))).toBe('LIBRO_INCONSISTENTE');
  });

  it('detecta reversos por un monto distinto', () => {
    const pago = registrar([], aplicarPago(P, [], { fecha: '2026-02-15', monto: 30_000 }, '2026-02-15'));
    const reverso = reversarPago(P, pago, 'm1', '2026-02-16');
    const malo = registrar(pago, { ...reverso, monto: -29_000 });
    expect(codigo(() => estadoPrestamo(P, malo, '2026-03-01'))).toBe('LIBRO_INCONSISTENTE');
  });
});
