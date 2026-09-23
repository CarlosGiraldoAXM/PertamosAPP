// Reportes de cartera. Todo el cálculo de plata sale de core; acá solo se suma
// y agrupa lo que core devuelve por préstamo.
import {
  analizarLibro,
  estadoPrestamo,
  interesMensual,
  repartirInteres,
  sumarDias,
  type EstadoFinanciero,
} from '@prestamos/core';
import type { PrestamoCompleto, Socio } from './cartera.ts';

export interface PrestamoConEstado extends PrestamoCompleto {
  estado: EstadoFinanciero;
}

export interface ResumenSocioCartera {
  socioId: string;
  nombre: string;
  capitalVivo: number;
  interesCobradoTotal: number;
  interesCobradoMes: number;
  interesMensualEsperado: number;
}

export interface ResumenCartera {
  prestamosActivos: number;
  capitalEnCalle: number;
  capitalPrestadoTotal: number;
  capitalRecuperado: number;
  interesCobradoTotal: number;
  interesCobradoMes: number;
  interesVencido: number;
  interesMensualEsperado: number;
  prestamosAtrasados: number;
  atrasados: PrestamoConEstado[];
  proximos: PrestamoConEstado[];
  socios: ResumenSocioCartera[];
}

export function conEstado(p: PrestamoCompleto, hoy: string): PrestamoConEstado {
  return { ...p, estado: estadoPrestamo(p.prestamo, p.movimientos, hoy) };
}

export function resumirCartera(cartera: PrestamoCompleto[], socios: Socio[], hoy: string): ResumenCartera {
  const mes = hoy.slice(0, 7);
  const enUnaSemana = sumarDias(hoy, 7);
  const lista = cartera.map((p) => conEstado(p, hoy));
  const activos = lista.filter((p) => p.fila.estado === 'activo');

  const porSocio = new Map<string, ResumenSocioCartera>(
    socios.map((s) => [
      s.id,
      { socioId: s.id, nombre: s.nombre, capitalVivo: 0, interesCobradoTotal: 0, interesCobradoMes: 0, interesMensualEsperado: 0 },
    ]),
  );

  let interesCobradoMes = 0;
  let interesMensualEsperado = 0;
  for (const p of lista) {
    for (const m of analizarLibro(p.prestamo, p.movimientos).efectivos) {
      for (const a of m.aplicaciones) {
        if (m.fecha.startsWith(mes)) interesCobradoMes += a.aInteres;
        for (const r of a.reparto) {
          const s = porSocio.get(r.socioId);
          if (!s) continue;
          s.interesCobradoTotal += r.interes;
          if (m.fecha.startsWith(mes)) s.interesCobradoMes += r.interes;
        }
      }
    }
    if (p.fila.estado !== 'activo') continue;

    const esperado = interesMensual(p.estado.saldoCapital, p.prestamo.tasaMensualBp);
    interesMensualEsperado += esperado;
    for (const r of repartirInteres(esperado, p.prestamo.socios)) {
      const s = porSocio.get(r.socioId);
      if (s) s.interesMensualEsperado += r.interes;
    }
    for (const s of p.estado.socios) {
      const resumen = porSocio.get(s.socioId);
      if (resumen) resumen.capitalVivo += s.capitalPendiente;
    }
  }

  const atrasados = activos.filter((p) => p.estado.diasAtraso > 0).sort((a, b) => b.estado.diasAtraso - a.estado.diasAtraso);
  const proximos = activos
    .filter((p) => p.estado.proximoCorte && p.estado.diasAtraso === 0 && p.estado.proximoCorte.fecha <= enUnaSemana)
    .sort((a, b) => a.estado.proximoCorte!.fecha.localeCompare(b.estado.proximoCorte!.fecha));

  return {
    prestamosActivos: activos.length,
    capitalEnCalle: activos.reduce((s, p) => s + p.estado.saldoCapital, 0),
    capitalPrestadoTotal: lista.reduce((s, p) => s + p.prestamo.capital, 0),
    capitalRecuperado: lista.reduce((s, p) => s + p.estado.capitalPagado, 0),
    interesCobradoTotal: lista.reduce((s, p) => s + p.estado.interesPagado, 0),
    interesCobradoMes,
    interesVencido: activos.reduce((s, p) => s + p.estado.interesVencidoPendiente, 0),
    interesMensualEsperado,
    prestamosAtrasados: atrasados.length,
    atrasados,
    proximos,
    socios: [...porSocio.values()].filter((s) => s.capitalVivo > 0 || s.interesCobradoTotal > 0 || s.interesMensualEsperado > 0),
  };
}
