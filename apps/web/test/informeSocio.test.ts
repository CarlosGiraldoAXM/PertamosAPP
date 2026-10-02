// Los datos del informe mensual para el socio (la hoja "PAGOS <MES> <AÑO>").
import { aplicarLiquidacion, aplicarPago, cotizarLiquidacion, type Movimiento, type Prestamo } from '@prestamos/core';
import { describe, expect, it } from 'vitest';
import type { PrestamoCompleto } from '../src/datos/cartera.ts';
import { armarInformeSocio } from '../src/datos/informeSocio.ts';
import { conEstado } from '../src/datos/reportes.ts';

const MATEO = { id: 'w', nombre: 'Mateo', activo: true };
const hoy = '2026-10-01';

interface Caso {
  id: string;
  cliente: string;
  vehiculo: string | null;
  placa: string | null;
  capital: number;
  tasaBp: number;
  /** Parte de la tasa que es de Mateo; el resto es del otro socio. */
  mateoBp: number;
  desembolso: string;
  creado: string;
  pagos?: [fecha: string, monto: number][];
  liquidar?: string;
  origen?: { capital: number; abonos: number[] };
}

function prestamo(c: Caso): PrestamoCompleto {
  const p: Prestamo = {
    capital: c.capital,
    tasaMensualBp: c.tasaBp,
    fechaDesembolso: c.desembolso,
    plazoMeses: null,
    socios: [
      { socioId: 'c', tasaBp: c.tasaBp - c.mateoBp, aporteCapital: 0 },
      { socioId: 'w', tasaBp: c.mateoBp, aporteCapital: c.capital },
    ],
  };
  let movimientos: Movimiento[] = [];
  for (const [fecha, monto] of c.pagos ?? []) {
    movimientos = [...movimientos, { ...aplicarPago(p, movimientos, { fecha, monto }, hoy), id: `${c.id}-${movimientos.length + 1}` }];
  }
  if (c.liquidar) {
    const total = cotizarLiquidacion(p, movimientos, c.liquidar, hoy).total;
    movimientos = [...movimientos, { ...aplicarLiquidacion(p, movimientos, c.liquidar, hoy, total), id: `${c.id}-fin` }];
  }
  return {
    fila: {
      id: c.id,
      cliente_id: `cli-${c.id}`,
      cliente_nombre: c.cliente,
      cliente_documento: null,
      capital_inicial: c.capital,
      tasa_mensual_bp: c.tasaBp,
      fecha_desembolso: c.desembolso,
      plazo_meses: null,
      estado: c.liquidar ? 'pagado' : 'activo',
      notas: null,
      vehiculo: c.vehiculo,
      placa: c.placa,
      origen: c.origen ?? null,
      created_at: c.creado,
      socios: [],
    },
    pagos: [],
    prestamo: p,
    movimientos,
  };
}

describe('armarInformeSocio', () => {
  const cartera = [
    // Registrado segundo, sin abonos: $40.000.000 al 3 %, Mateo 2,5 %.
    prestamo({ id: 'b', cliente: 'CLIENTE UNO DE PRUEBA', vehiculo: 'CX 3', placa: 'AAA 111', capital: 40_000_000, tasaBp: 300, mateoBp: 250, desembolso: '2026-09-05', creado: '2026-09-05T10:00:00Z' }),
    // Registrado primero, con tres abonos a capital (y el interés de cada mes).
    prestamo({
      id: 'a',
      cliente: 'CLIENTE SEIS DE PRUEBA',
      vehiculo: 'MAZDA 3 BLANCO',
      placa: 'FFF 666',
      capital: 21_000_000,
      tasaBp: 300,
      mateoBp: 200,
      desembolso: '2026-06-20',
      creado: '2026-06-20T10:00:00Z',
      pagos: [
        ['2026-07-20', 630_000 + 5_000_000],
        ['2026-08-20', 480_000 + 4_000_000],
        ['2026-09-20', 360_000 + 3_000_000],
      ],
    }),
    // Cancelado: no va en el informe.
    prestamo({ id: 'z', cliente: 'YA PAGÓ', vehiculo: null, placa: null, capital: 5_000_000, tasaBp: 300, mateoBp: 250, desembolso: '2026-07-01', creado: '2026-07-01T10:00:00Z', liquidar: '2026-08-01' }),
  ].map((p) => conEstado(p, hoy));

  const informe = armarInformeSocio(cartera, MATEO, hoy, '  Salen dos créditos.  ');

  it('se titula con el mes y el año, y lleva el nombre del socio', () => {
    expect(informe.titulo).toBe('PAGOS OCTUBRE 2026');
    expect(informe.socio).toBe('Mateo');
    expect(informe.observaciones).toBe('Salen dos créditos.');
  });

  it('lista solo los préstamos activos, numerados en el orden en que se registraron', () => {
    expect(informe.filas.map((f) => [f.numero, f.cliente])).toEqual([
      [1, 'CLIENTE SEIS DE PRUEBA'],
      [2, 'CLIENTE UNO DE PRUEBA'],
    ]);
  });

  it('una fila sin abonos: saldo igual al préstamo, interés total y parte del socio', () => {
    expect(informe.filas[1]).toEqual({
      numero: 2,
      cliente: 'CLIENTE UNO DE PRUEBA',
      vehiculo: 'CX 3',
      placa: 'AAA 111',
      prestamo: 40_000_000,
      abonos: [],
      saldo: 40_000_000,
      fechaPago: '2026-10-05',
      tasaBp: 300,
      totalInteres: 1_200_000,
      interesSocio: 1_000_000,
      socioBp: 250,
    });
  });

  it('una fila con abonos: los lista en orden y calcula sobre el saldo de hoy', () => {
    const f = informe.filas[0]!;
    expect(f.abonos).toEqual([5_000_000, 4_000_000, 3_000_000]);
    expect(f.saldo).toBe(9_000_000);
    expect(f.prestamo).toBe(21_000_000);
    expect(f.totalInteres).toBe(270_000); // 3 % de 9.000.000
    expect(f.interesSocio).toBe(180_000); // 2 % de 9.000.000
    expect(f.fechaPago).toBe('2026-10-20');
  });

  it('los totales suman las filas', () => {
    expect(informe.totalSaldo).toBe(49_000_000);
    expect(informe.totalInteres).toBe(1_470_000);
    expect(informe.totalInteresSocio).toBe(1_180_000);
  });

  it('un socio que no participa en un préstamo aparece con 0', () => {
    const otro = armarInformeSocio(cartera, { id: 'nadie', nombre: 'Otro', activo: true }, hoy);
    expect(otro.filas.map((f) => [f.interesSocio, f.socioBp])).toEqual([
      [0, 0],
      [0, 0],
    ]);
  });

  it('un saldo de apertura muestra el préstamo original y los abonos anteriores, seguidos de los nuevos', () => {
    // Se cargó con saldo 9.000.000 de un préstamo original de 21.000.000 con tres abonos previos;
    // ya en el sistema, el cliente pagó el mes y abonó 1.000.000 más.
    const apertura = prestamo({
      id: 'ap',
      cliente: 'SALDO DE APERTURA',
      vehiculo: null,
      placa: null,
      capital: 9_000_000,
      tasaBp: 300,
      mateoBp: 200,
      desembolso: '2026-08-20',
      creado: '2026-08-20T10:00:00Z',
      origen: { capital: 21_000_000, abonos: [5_000_000, 4_000_000, 3_000_000] },
      pagos: [['2026-09-20', 270_000 + 1_000_000]],
    });
    const f = armarInformeSocio([conEstado(apertura, hoy)], MATEO, hoy).filas[0]!;
    expect(f.prestamo).toBe(21_000_000);
    expect(f.abonos).toEqual([5_000_000, 4_000_000, 3_000_000, 1_000_000]);
    expect(f.saldo).toBe(8_000_000);
    expect(f.totalInteres).toBe(240_000);
  });

  it('sin préstamos activos queda vacío', () => {
    const vacio = armarInformeSocio([], MATEO, '2026-01-15');
    expect(vacio).toMatchObject({ titulo: 'PAGOS ENERO 2026', filas: [], totalSaldo: 0 });
  });
});
