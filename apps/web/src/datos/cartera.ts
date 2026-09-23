// Lecturas de la base (todas pasan por RLS) y su traducción a los tipos de core.
import type { Movimiento, Prestamo } from '@prestamos/core';
import { supabase } from '../lib/supabase.ts';

export interface Usuario {
  id: string;
  email: string;
  email_google: string | null;
  nombre: string;
  rol: 'admin' | 'consulta';
  activo: boolean;
  debe_cambiar_clave: boolean;
}

export interface Cliente {
  id: string;
  nombre: string;
  documento: string | null;
  telefono: string | null;
  direccion: string | null;
  notas: string | null;
}

export interface Socio {
  id: string;
  nombre: string;
  activo: boolean;
}

export interface PrestamoFila {
  id: string;
  cliente_id: string;
  capital_inicial: number;
  tasa_mensual_bp: number;
  fecha_desembolso: string;
  plazo_meses: number | null;
  estado: 'activo' | 'pagado' | 'castigado';
  notas: string | null;
  created_at: string;
  clientes: { nombre: string } | null;
  prestamo_socios: { socio_id: string; tasa_bp: number; aporte_capital: number }[];
}

export interface PagoFila {
  id: string;
  prestamo_id: string;
  tipo: 'pago' | 'liquidacion' | 'reverso';
  fecha: string;
  monto: number;
  medio: string | null;
  nota: string | null;
  reversa_de: string | null;
  secuencia: number;
  created_at: string;
  aplicaciones: {
    id: string;
    periodo: number | null;
    a_interes: number;
    a_capital: number;
    reparto_socios: { socio_id: string; interes: number; capital: number }[];
  }[];
}

/** Un préstamo con todo lo necesario para calcular su estado con core. */
export interface PrestamoCompleto {
  fila: PrestamoFila;
  prestamo: Prestamo;
  pagos: PagoFila[];
  movimientos: Movimiento[];
}

const LOTE = 1000; // max_rows de la API

/** Trae todas las filas paginando: la API corta en 1.000 y un libro truncado daría saldos falsos. */
async function todas<T>(
  consulta: (desde: number, hasta: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const filas: T[] = [];
  for (let desde = 0; ; desde += LOTE) {
    const { data, error } = await consulta(desde, desde + LOTE - 1);
    if (error) throw new Error(error.message);
    filas.push(...(data ?? []));
    if (!data || data.length < LOTE) return filas;
  }
}

export async function cargarUsuario(id: string): Promise<Usuario | null> {
  const { data, error } = await supabase.from('usuarios').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return data as Usuario | null;
}

export async function cargarClientes(): Promise<Cliente[]> {
  return todas<Cliente>((d, h) => supabase.from('clientes').select('*').order('nombre').order('id').range(d, h));
}

export async function cargarCliente(id: string): Promise<Cliente | null> {
  const { data, error } = await supabase.from('clientes').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return data as Cliente | null;
}

export async function cargarSocios(): Promise<Socio[]> {
  const { data, error } = await supabase.from('socios').select('id, nombre, activo').order('nombre');
  if (error) throw new Error(error.message);
  return data as Socio[];
}

const SELECT_PRESTAMO = '*, clientes(nombre), prestamo_socios(socio_id, tasa_bp, aporte_capital)';
const SELECT_PAGO = '*, aplicaciones(id, periodo, a_interes, a_capital, reparto_socios(socio_id, interes, capital))';

function aMovimiento(p: PagoFila): Movimiento {
  return {
    id: p.id,
    tipo: p.tipo,
    fecha: p.fecha,
    monto: p.monto,
    reversaDe: p.reversa_de,
    aplicaciones: p.aplicaciones.map((a) => ({
      periodo: a.periodo,
      aInteres: a.a_interes,
      aCapital: a.a_capital,
      reparto: a.reparto_socios.map((r) => ({ socioId: r.socio_id, interes: r.interes, capital: r.capital })),
    })),
  };
}

function armar(fila: PrestamoFila, pagos: PagoFila[]): PrestamoCompleto {
  const socios = [...fila.prestamo_socios].sort((a, b) => a.socio_id.localeCompare(b.socio_id));
  return {
    fila,
    prestamo: {
      capital: fila.capital_inicial,
      tasaMensualBp: fila.tasa_mensual_bp,
      fechaDesembolso: fila.fecha_desembolso,
      plazoMeses: fila.plazo_meses,
      socios: socios.map((s) => ({ socioId: s.socio_id, tasaBp: s.tasa_bp, aporteCapital: s.aporte_capital })),
    },
    pagos,
    movimientos: pagos.map(aMovimiento),
  };
}

/** Préstamos con su libro completo. Sin filtro trae toda la cartera. */
export async function cargarPrestamos(filtro: { prestamoId?: string; clienteId?: string } = {}): Promise<PrestamoCompleto[]> {
  const filas = await todas<PrestamoFila>((d, h) => {
    let q = supabase.from('prestamos').select(SELECT_PRESTAMO);
    if (filtro.prestamoId) q = q.eq('id', filtro.prestamoId);
    if (filtro.clienteId) q = q.eq('cliente_id', filtro.clienteId);
    return q.order('fecha_desembolso', { ascending: false }).order('id').range(d, h);
  });
  if (filas.length === 0) return [];

  const pagos = await todas<PagoFila>((d, h) => {
    let q = supabase.from('pagos').select(SELECT_PAGO);
    if (filtro.prestamoId) q = q.eq('prestamo_id', filtro.prestamoId);
    else if (filtro.clienteId) q = q.in('prestamo_id', filas.map((f) => f.id));
    return q.order('secuencia').range(d, h);
  });

  const porPrestamo = new Map<string, PagoFila[]>();
  for (const p of pagos) {
    const lista = porPrestamo.get(p.prestamo_id) ?? [];
    lista.push(p);
    porPrestamo.set(p.prestamo_id, lista);
  }
  return filas.map((f) => armar(f, porPrestamo.get(f.id) ?? []));
}

export async function cargarPrestamo(id: string): Promise<PrestamoCompleto | null> {
  const [p] = await cargarPrestamos({ prestamoId: id });
  return p ?? null;
}
