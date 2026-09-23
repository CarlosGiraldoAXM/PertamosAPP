// Cliente mínimo contra Supabase local (`npm run db:start`). Usa los usuarios
// del seed. Las claves locales son las de desarrollo de la CLI.
export const API = process.env.SUPABASE_URL ?? 'http://127.0.0.1:55621';
export const PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY ?? 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH';

/** Conexión directa a la base local (credenciales por defecto de la CLI). */
export const DB_URL = process.env.DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:55622/postgres';

export const SEED = {
  admin: { email: 'admin@local.test', clave: 'Admin12345' },
  consulta: { email: 'consulta@local.test', clave: 'Consulta12345' },
  socioA: '10000000-0000-4000-8000-000000000001',
  socioB: '10000000-0000-4000-8000-000000000002',
  cliente: '20000000-0000-4000-8000-000000000001',
};

export async function iniciarSesion(email: string, clave: string): Promise<string> {
  const r = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: clave }),
  });
  if (!r.ok) throw new Error(`Login de ${email} falló: ${r.status} ${await r.text()}`);
  return ((await r.json()) as { access_token: string }).access_token;
}

export interface Respuesta<T = any> {
  status: number;
  cuerpo: T;
}

export async function llamar<T = any>(funcion: string, cuerpo: unknown, token?: string): Promise<Respuesta<T>> {
  const headers: Record<string, string> = { apikey: PUBLISHABLE_KEY, 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(`${API}/functions/v1/${funcion}`, { method: 'POST', headers, body: JSON.stringify(cuerpo) });
  const texto = await r.text();
  return { status: r.status, cuerpo: texto ? JSON.parse(texto) : null };
}

/** Lectura por la API REST con el token del usuario (pasa por RLS). */
export async function leer<T = any>(ruta: string, token: string): Promise<T> {
  const r = await fetch(`${API}/rest/v1/${ruta}`, { headers: { apikey: PUBLISHABLE_KEY, Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`GET ${ruta} → ${r.status} ${await r.text()}`);
  return (await r.json()) as T;
}

/** Préstamo de $1.000.000 al 3 %: socio A 1 % y $400.000, socio B 2 % y $600.000. */
export function prestamoBase(extra: Record<string, unknown> = {}) {
  return {
    clienteId: SEED.cliente,
    capital: 1_000_000,
    tasaMensualBp: 300,
    fechaDesembolso: '2026-01-15',
    plazoMeses: null,
    socios: [
      { socioId: SEED.socioA, tasaBp: 100, aporteCapital: 400_000 },
      { socioId: SEED.socioB, tasaBp: 200, aporteCapital: 600_000 },
    ],
    ...extra,
  };
}
