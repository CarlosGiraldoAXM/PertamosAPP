// Informe mensual para revisar con un socio: la misma hoja que se llevaba a
// mano en Excel ("PAGOS <MES> <AÑO>"), una fila por préstamo activo.
// Todo sale de core; esta función solo ordena y suma.
import { analizarLibro, interesMensual, repartirInteres } from '@prestamos/core';
import type { Socio } from './cartera.ts';
import type { PrestamoConEstado } from './reportes.ts';

export interface FilaInforme {
  numero: number;
  cliente: string;
  vehiculo: string | null;
  placa: string | null;
  /** Capital que se prestó (el original, si el préstamo se cargó como saldo de apertura). */
  prestamo: number;
  /** Cada abono a capital, en el orden en que se hizo. */
  abonos: number[];
  /** Capital que debe hoy. */
  saldo: number;
  /** Próximo corte (YYYY-MM-DD). */
  fechaPago: string | null;
  tasaBp: number;
  /** Interés de un mes sobre el saldo de hoy. */
  totalInteres: number;
  /** Parte de ese interés que es del socio del informe, y su tasa. */
  interesSocio: number;
  socioBp: number;
}

export interface InformeSocio {
  /** 'PAGOS OCTUBRE 2026' */
  titulo: string;
  socio: string;
  filas: FilaInforme[];
  totalSaldo: number;
  totalInteres: number;
  totalInteresSocio: number;
  observaciones: string;
}

const MESES = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];

export function armarInformeSocio(cartera: PrestamoConEstado[], socio: Socio, hoy: string, observaciones = ''): InformeSocio {
  const filas: FilaInforme[] = cartera
    .filter((p) => p.fila.estado === 'activo')
    // En el orden en que se registraron, como en la hoja.
    .sort((a, b) => a.fila.created_at.localeCompare(b.fila.created_at) || a.fila.id.localeCompare(b.fila.id))
    .map((p, i) => {
      const saldo = p.estado.saldoCapital;
      const totalInteres = interesMensual(saldo, p.prestamo.tasaMensualBp);
      const parte = p.prestamo.socios.find((s) => s.socioId === socio.id);
      const reparto = repartirInteres(totalInteres, p.prestamo.socios).find((r) => r.socioId === socio.id);
      return {
        numero: i + 1,
        cliente: p.fila.cliente_nombre,
        vehiculo: p.fila.vehiculo,
        placa: p.fila.placa,
        // En un saldo de apertura, lo que se prestó originalmente; si no, el capital del préstamo.
        prestamo: p.fila.origen?.capital ?? p.prestamo.capital,
        // Los abonos anteriores a la carga, seguidos de los registrados en el sistema.
        abonos: [
          ...(p.fila.origen?.abonos ?? []),
          ...analizarLibro(p.prestamo, p.movimientos)
            .efectivos.map((m) => m.aplicaciones.reduce((s, a) => s + a.aCapital, 0))
            .filter((abono) => abono > 0),
        ],
        saldo,
        fechaPago: p.estado.proximoCorte?.fecha ?? null,
        tasaBp: p.prestamo.tasaMensualBp,
        totalInteres,
        interesSocio: reparto?.interes ?? 0,
        socioBp: parte?.tasaBp ?? 0,
      };
    });

  return {
    titulo: `PAGOS ${MESES[Number(hoy.slice(5, 7)) - 1]} ${hoy.slice(0, 4)}`,
    socio: socio.nombre,
    filas,
    totalSaldo: filas.reduce((s, f) => s + f.saldo, 0),
    totalInteres: filas.reduce((s, f) => s + f.totalInteres, 0),
    totalInteresSocio: filas.reduce((s, f) => s + f.interesSocio, 0),
    observaciones: observaciones.trim(),
  };
}
