// Lecturas y escrituras contra la API, y su traducción a los tipos de core.
import type { Movimiento, Prestamo } from '@prestamos/core';
import { aCore, type Cliente, type PagoFila, type PrestamoDatos, type PrestamoFila, type Socio } from '../../compartido/api.ts';
import { api, ErrorApi } from '../lib/api.ts';

export type { Cliente, PagoFila, PrestamoFila, Socio };

/** Un préstamo con todo lo necesario para calcular su estado con core. */
export interface PrestamoCompleto extends PrestamoDatos {
  prestamo: Prestamo;
  movimientos: Movimiento[];
}

function completo(d: PrestamoDatos): PrestamoCompleto {
  return { ...d, ...aCore(d) };
}

async function oNull<T>(promesa: Promise<T>): Promise<T | null> {
  try {
    return await promesa;
  } catch (e) {
    if (e instanceof ErrorApi && e.status === 404) return null;
    throw e;
  }
}

export const cargarClientes = () => api<Cliente[]>('GET', '/clientes');
export const cargarCliente = (id: string) => oNull(api<Cliente>('GET', `/clientes/${id}`));
export const guardarCliente = (datos: Omit<Cliente, 'id'>, id?: string) =>
  id ? api<Cliente>('PATCH', `/clientes/${id}`, datos) : api<Cliente>('POST', '/clientes', datos);

export const cargarSocios = () => api<Socio[]>('GET', '/socios');
export const crearSocio = (nombre: string) => api<Socio[]>('POST', '/socios', { nombre });
export const editarSocio = (id: string, cambios: { nombre?: string; activo?: boolean }) => api<Socio[]>('PATCH', `/socios/${id}`, cambios);

/** Préstamos con su libro completo. Sin filtro trae toda la cartera. */
export async function cargarPrestamos(filtro: { clienteId?: string } = {}): Promise<PrestamoCompleto[]> {
  const consulta = filtro.clienteId ? `?clienteId=${filtro.clienteId}` : '';
  return (await api<PrestamoDatos[]>('GET', `/prestamos${consulta}`)).map(completo);
}

export async function cargarPrestamo(id: string): Promise<PrestamoCompleto | null> {
  const d = await oNull(api<PrestamoDatos>('GET', `/prestamos/${id}`));
  return d ? completo(d) : null;
}
