// Datos del estado de cuenta que se le entrega al CLIENTE. Solo lo que a él le
// importa: qué pagó, cómo se repartió cada pago entre interés y capital, y
// cuánto debe. El reparto entre socios es interno y no aparece acá.
// Todo sale de core; esta función solo ordena y suma.
import { analizarLibro, cotizarLiquidacion, ErrorNegocio } from '@prestamos/core';
import type { PrestamoConEstado } from './reportes.ts';

export interface PagoDelEstado {
  fecha: string;
  tipo: 'pago' | 'liquidacion';
  medio: string | null;
  monto: number;
  aInteres: number;
  aCapital: number;
  /** Capital que quedó debiendo después de este pago. */
  saldoDespues: number;
}

export interface MesDelEstado {
  numero: number;
  fechaCorte: string;
  saldoBase: number;
  interes: number;
  pagado: number;
  pendiente: number;
  estado: 'pagado' | 'vencido' | 'curso';
}

export interface EstadoDeCuenta {
  fecha: string;
  cliente: { nombre: string; documento: string | null };
  prestamo: { capital: number; tasaMensualBp: number; fechaDesembolso: string; plazoMeses: number | null; cancelado: boolean };
  capitalPendiente: number;
  capitalAbonado: number;
  interesPagado: number;
  totalPagado: number;
  interesVencido: number;
  mesesAtrasados: number;
  /**
   * Próximo corte: fecha y valor a pagar (ya redondeado a los mil). Con el plazo
   * cumplido, ese pago incluye además todo el capital.
   */
  proximoPago: { fecha: string; monto: number; incluyeCapital: boolean } | null;
  /** Lo que costaría cancelar todo en `fecha`; null si ya está cancelado. */
  paraCancelarHoy: { interes: number; capital: number; total: number } | null;
  pagos: PagoDelEstado[];
  meses: MesDelEstado[];
}

export function armarEstadoDeCuenta(p: PrestamoConEstado, hoy: string): EstadoDeCuenta {
  const e = p.estado;
  const mediosPorId = new Map(p.pagos.map((x) => [x.id, x.medio]));

  // Solo los pagos vigentes: uno reversado y su reverso no le dicen nada al cliente.
  let saldo = p.prestamo.capital;
  const pagos: PagoDelEstado[] = analizarLibro(p.prestamo, p.movimientos).efectivos.map((m) => {
    const aInteres = m.aplicaciones.reduce((s, a) => s + a.aInteres, 0);
    const aCapital = m.aplicaciones.reduce((s, a) => s + a.aCapital, 0);
    saldo -= aCapital;
    return {
      fecha: m.fecha,
      tipo: m.tipo === 'liquidacion' ? 'liquidacion' : 'pago',
      medio: mediosPorId.get(m.id) ?? null,
      monto: m.monto,
      aInteres,
      aCapital,
      saldoDespues: saldo,
    };
  });

  let paraCancelarHoy: EstadoDeCuenta['paraCancelarHoy'] = null;
  if (!e.cancelado && p.fila.estado === 'activo') {
    try {
      const c = cotizarLiquidacion(p.prestamo, p.movimientos, hoy, hoy);
      paraCancelarHoy = { interes: c.interesVencido + c.interesEnCurso, capital: c.capital, total: c.total };
    } catch (err) {
      if (!(err instanceof ErrorNegocio)) throw err;
    }
  }

  // Los meses posteriores a la cancelación no generan nada: no se listan.
  const meses: MesDelEstado[] = e.periodos
    .filter((per) => per.interes > 0 || per.pagado > 0)
    .map((per) => ({
      numero: per.numero,
      fechaCorte: per.fechaCorte,
      saldoBase: per.saldoBase,
      interes: per.interes,
      pagado: per.pagado,
      pendiente: per.pendiente,
      estado: per.pendiente === 0 ? 'pagado' : per.vencido ? 'vencido' : 'curso',
    }));

  return {
    fecha: hoy,
    cliente: { nombre: p.fila.cliente_nombre, documento: p.fila.cliente_documento },
    prestamo: {
      capital: p.prestamo.capital,
      tasaMensualBp: p.prestamo.tasaMensualBp,
      fechaDesembolso: p.prestamo.fechaDesembolso,
      plazoMeses: p.prestamo.plazoMeses,
      cancelado: e.cancelado,
    },
    capitalPendiente: e.saldoCapital,
    capitalAbonado: e.capitalPagado,
    interesPagado: e.interesPagado,
    totalPagado: e.capitalPagado + e.interesPagado,
    interesVencido: e.interesVencidoPendiente,
    mesesAtrasados: e.periodosAtrasados,
    proximoPago: e.proximoCorte
      ? {
          fecha: e.proximoCorte.fecha,
          monto: e.proximoCorte.cuotaACobrar,
          incluyeCapital: p.prestamo.plazoMeses !== null && e.proximoCorte.numero >= p.prestamo.plazoMeses,
        }
      : null,
    paraCancelarHoy,
    pagos,
    meses,
  };
}
