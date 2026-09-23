import type { Tx } from './db.ts';
import { ErrorHttp } from './http.ts';

/**
 * Valida el token del llamante contra Supabase Auth (que también detecta
 * sesiones cerradas o usuarios borrados) y devuelve su id.
 */
export async function usuarioAutenticado(req: Request): Promise<string> {
  const autorizacion = req.headers.get('Authorization') ?? '';
  if (!autorizacion.startsWith('Bearer ')) throw new ErrorHttp(401, 'NO_AUTENTICADO', 'Falta el token de sesión');

  const url = Deno.env.get('SUPABASE_URL');
  const apikey = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY');
  if (!url || !apikey) throw new Error('Faltan SUPABASE_URL o la clave pública en el entorno');

  const r = await fetch(`${url}/auth/v1/user`, { headers: { Authorization: autorizacion, apikey } });
  if (!r.ok) throw new ErrorHttp(401, 'NO_AUTENTICADO', 'Sesión inválida o vencida');
  const usuario = (await r.json()) as { id?: string };
  if (!usuario.id) throw new ErrorHttp(401, 'NO_AUTENTICADO', 'Sesión inválida');
  return usuario.id;
}

/** Exige que el usuario esté activo y sea admin. Se llama dentro de la transacción. */
export async function exigirAdmin(tx: Tx, usuarioId: string): Promise<void> {
  const [u] = await tx`select rol, activo from public.usuarios where id = ${usuarioId}`;
  if (!u || !u.activo) throw new ErrorHttp(403, 'SIN_PERMISO', 'Usuario no habilitado en el sistema');
  if (u.rol !== 'admin') throw new ErrorHttp(403, 'SIN_PERMISO', 'Solo un administrador puede hacer esta operación');
}
