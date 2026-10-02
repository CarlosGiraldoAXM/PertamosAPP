// Contrato entre la app (src/) y la API del Worker (worker/). Las formas de las
// filas son las de la base; la traducción a los tipos de core vive en `aCore`.
import type { Movimiento, Prestamo } from '@prestamos/core';

export interface Cliente {
  id: string;
  nombre: string;
  documento: string | null;
  telefono: string | null;
  direccion: string | null;
  notas: string | null;
}

/** Un cliente oculto por eliminación lógica; conserva todo su historial. */
export interface ClienteEliminado {
  id: string;
  nombre: string;
  documento: string | null;
  eliminado_en: string;
  prestamos: number;
}

export interface Socio {
  id: string;
  nombre: string;
  activo: boolean;
}

export interface PrestamoFila {
  id: string;
  cliente_id: string;
  cliente_nombre: string;
  cliente_documento: string | null;
  capital_inicial: number;
  tasa_mensual_bp: number;
  fecha_desembolso: string;
  plazo_meses: number | null;
  estado: 'activo' | 'pagado' | 'castigado';
  notas: string | null;
  /** Garantía: el vehículo y su placa, como van en el informe para el socio. */
  vehiculo: string | null;
  placa: string | null;
  created_at: string;
  socios: { socio_id: string; tasa_bp: number; aporte_capital: number }[];
}

export interface PagoFila {
  id: string;
  prestamo_id: string;
  /** Consecutivo del movimiento dentro del préstamo (orden de registro). */
  numero: number;
  tipo: 'pago' | 'liquidacion' | 'reverso';
  fecha: string;
  monto: number;
  medio: string | null;
  nota: string | null;
  reversa_de: string | null;
  created_at: string;
  aplicaciones: {
    id: string;
    periodo: number | null;
    a_interes: number;
    a_capital: number;
    reparto: { socio_id: string; interes: number; capital: number }[];
  }[];
}

/** Un préstamo con su libro completo, tal como lo devuelve GET /api/prestamos. */
export interface PrestamoDatos {
  fila: PrestamoFila;
  pagos: PagoFila[];
}

/** Traduce las filas de la base a los tipos con los que calcula core. */
export function aCore(d: PrestamoDatos): { prestamo: Prestamo; movimientos: Movimiento[] } {
  return {
    prestamo: {
      capital: d.fila.capital_inicial,
      tasaMensualBp: d.fila.tasa_mensual_bp,
      fechaDesembolso: d.fila.fecha_desembolso,
      plazoMeses: d.fila.plazo_meses,
      socios: d.fila.socios.map((s) => ({ socioId: s.socio_id, tasaBp: s.tasa_bp, aporteCapital: s.aporte_capital })),
    },
    movimientos: d.pagos.map((p) => ({
      id: p.id,
      tipo: p.tipo,
      fecha: p.fecha,
      monto: p.monto,
      reversaDe: p.reversa_de,
      aplicaciones: p.aplicaciones.map((a) => ({
        periodo: a.periodo,
        aInteres: a.a_interes,
        aCapital: a.a_capital,
        reparto: a.reparto.map((r) => ({ socioId: r.socio_id, interes: r.interes, capital: r.capital })),
      })),
    })),
  };
}
