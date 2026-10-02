// Los números del Inicio: se arma una cartera a mano (los pagos los imputa core,
// igual que el Worker) y se comprueba lo que resume cada gráfica.
import { aplicarPago, type Movimiento, type Prestamo } from '@prestamos/core';
import { describe, expect, it } from 'vitest';
import type { PrestamoCompleto } from '../src/datos/cartera.ts';
import { resumirCartera } from '../src/datos/reportes.ts';

const SOCIOS = [
  { id: 'a', nombre: 'Andrés', activo: true },
  { id: 'c', nombre: 'Carlos', activo: true },
];

/** $1.000.000 al 3 %: Andrés 2 % y $600.000, Carlos 1 % y $400.000. */
function prestamo(id: string, fechaDesembolso: string, pagos: [fecha: string, monto: number][]): PrestamoCompleto {
  const p: Prestamo = {
    capital: 1_000_000,
    tasaMensualBp: 300,
    fechaDesembolso,
    plazoMeses: null,
    socios: [
      { socioId: 'a', tasaBp: 200, aporteCapital: 600_000 },
      { socioId: 'c', tasaBp: 100, aporteCapital: 400_000 },
    ],
  };
  const movimientos: Movimiento[] = [];
  for (const [fecha, monto] of pagos) {
    movimientos.push({ ...aplicarPago(p, movimientos, { fecha, monto }, '2027-12-31'), id: `${id}-${movimientos.length + 1}` });
  }
  return {
    fila: {
      id,
      cliente_id: 'cli',
      cliente_nombre: `Cliente ${id}`,
      cliente_documento: null,
      capital_inicial: p.capital,
      tasa_mensual_bp: p.tasaMensualBp,
      fecha_desembolso: fechaDesembolso,
      plazo_meses: null,
      estado: 'activo',
      notas: null,
      vehiculo: null,
      placa: null,
      created_at: '',
      socios: [],
    },
    pagos: [],
    prestamo: p,
    movimientos,
  };
}

describe('resumirCartera', () => {
  // Hoy = 10-feb-2027. "alDia" pagó todos sus cortes; "atrasado" dejó de pagar en diciembre.
  const hoy = '2027-02-10';
  const alDia = prestamo('alDia', '2026-09-15', [
    ['2026-10-15', 30_000],
    ['2026-11-15', 30_000],
    ['2026-12-15', 230_000], // 30.000 de interés + 200.000 de capital
    ['2027-01-15', 24_000],
  ]);
  const atrasado = prestamo('atrasado', '2026-10-05', [['2026-11-05', 30_000]]);
  const r = resumirCartera([alDia, atrasado], SOCIOS, hoy);

  it('arma los últimos 6 meses cruzando el cambio de año, con el mes en curso al final', () => {
    expect(r.interesPorMes.map((m) => m.mes)).toEqual(['2026-09', '2026-10', '2026-11', '2026-12', '2027-01', '2027-02']);
  });

  it('suma por mes solo el interés cobrado, no el capital', () => {
    expect(r.interesPorMes.map((m) => m.total)).toEqual([0, 30_000, 60_000, 30_000, 24_000, 0]);
    expect(r.interesCobradoMes).toBe(0);
    expect(r.interesCobradoTotal).toBe(144_000);
  });

  it('separa el capital al día del que tiene pagos atrasados', () => {
    expect(r.capitalAlDia).toBe(800_000);
    expect(r.capitalAtrasado).toBe(1_000_000);
    expect(r.capitalAlDia + r.capitalAtrasado).toBe(r.capitalEnCalle);
    expect(r.atrasados.map((p) => p.fila.id)).toEqual(['atrasado']);
  });

  it('el interés vencido es el de los meses sin pagar del préstamo atrasado', () => {
    // Cortes del 5-dic, 5-ene y 5-feb sin pagar: 3 × 30.000.
    expect(r.interesVencido).toBe(90_000);
  });

  it('reparte entre socios y las partes cuadran con los totales', () => {
    const porNombre = Object.fromEntries(r.socios.map((s) => [s.nombre, s]));
    // Capital vivo: 60 % / 40 % de 1.800.000.
    expect(porNombre.Andrés!.capitalVivo).toBe(1_080_000);
    expect(porNombre.Carlos!.capitalVivo).toBe(720_000);
    expect(r.socios.reduce((s, x) => s + x.capitalVivo, 0)).toBe(r.capitalEnCalle);
    expect(r.socios.reduce((s, x) => s + x.interesCobradoTotal, 0)).toBe(r.interesCobradoTotal);
    expect(r.socios.reduce((s, x) => s + x.interesMensualEsperado, 0)).toBe(r.interesMensualEsperado);
    // Esperado por mes: 3 % de 800.000 + 3 % de 1.000.000.
    expect(r.interesMensualEsperado).toBe(54_000);
  });

  it('una cartera vacía no rompe nada', () => {
    const vacio = resumirCartera([], SOCIOS, hoy);
    expect(vacio.interesPorMes).toHaveLength(6);
    expect(vacio.capitalEnCalle).toBe(0);
    expect(vacio.socios).toEqual([]);
  });
});
