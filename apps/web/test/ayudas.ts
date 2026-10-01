import { env, exports } from 'cloudflare:workers';
import type { Cliente, PrestamoDatos, Socio } from '../compartido/api.ts';

export const db = env.DB;

export interface Respuesta<T = any> {
  status: number;
  cuerpo: T;
}

/** Llama a la API del Worker tal como lo haría el navegador. */
export async function pedir<T = any>(metodo: 'GET' | 'POST' | 'PATCH', ruta: string, cuerpo?: unknown): Promise<Respuesta<T>> {
  const r = await exports.default.fetch(
    new Request(`http://prestamos.test/api${ruta}`, {
      method: metodo,
      headers: cuerpo === undefined ? {} : { 'Content-Type': 'application/json' },
      body: cuerpo === undefined ? null : JSON.stringify(cuerpo),
    }),
  );
  return { status: r.status, cuerpo: await r.json() };
}

let contador = 0;

/** Dos socios y un cliente nuevos para cada caso, así los tests no se pisan. */
export async function escenario(): Promise<{ socioA: string; socioB: string; cliente: string }> {
  const n = `${Date.now()}-${++contador}`;
  const a = await pedir<Socio[]>('POST', '/socios', { nombre: `A ${n}` });
  const b = await pedir<Socio[]>('POST', '/socios', { nombre: `B ${n}` });
  const c = await pedir<Cliente>('POST', '/clientes', { nombre: `Cliente ${n}`, documento: n });
  return {
    socioA: a.cuerpo.find((s) => s.nombre === `A ${n}`)!.id,
    socioB: b.cuerpo.find((s) => s.nombre === `B ${n}`)!.id,
    cliente: c.cuerpo.id,
  };
}

/** $1.000.000 al 3 %: socio A 1 % y $400.000, socio B 2 % y $600.000. Desembolso 15-ene-2026. */
export function cuerpoPrestamo(e: { socioA: string; socioB: string; cliente: string }, extra: Record<string, unknown> = {}) {
  return {
    clienteId: e.cliente,
    capital: 1_000_000,
    tasaMensualBp: 300,
    fechaDesembolso: '2026-01-15',
    plazoMeses: null,
    socios: [
      { socioId: e.socioA, tasaBp: 100, aporteCapital: 400_000 },
      { socioId: e.socioB, tasaBp: 200, aporteCapital: 600_000 },
    ],
    ...extra,
  };
}

export async function prestamoNuevo(extra: Record<string, unknown> = {}) {
  const e = await escenario();
  const r = await pedir('POST', '/prestamos', cuerpoPrestamo(e, extra));
  if (r.status !== 200) throw new Error(`No se pudo crear el préstamo: ${JSON.stringify(r.cuerpo)}`);
  return { ...e, prestamo: r.cuerpo.prestamoId as string };
}

export async function libro(prestamoId: string): Promise<PrestamoDatos> {
  return (await pedir<PrestamoDatos>('GET', `/prestamos/${prestamoId}`)).cuerpo;
}

/** Mensaje del error con el que la base rechaza una sentencia. */
export async function rechazo(promesa: Promise<unknown>): Promise<string> {
  try {
    await promesa;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  throw new Error('Se esperaba que la base rechazara la operación');
}
