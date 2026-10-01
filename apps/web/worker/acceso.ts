// Punto ÚNICO de control de acceso de la API. Toda petición a /api/* pasa por acá.
//
// Etapa actual (decisión del dueño, 2026-10-01): sin login. Cualquiera que
// llegue a la API tiene permisos completos. Es aceptable solo mientras la app
// corra en local o en una dirección que nadie más conozca.
//
// Para agregar login (Cloudflare Access, Google o una clave compartida) se
// cambia SOLO esta función: identificar al llamante desde `request` y devolver
// su rol, o lanzar ErrorHttp(401/403). El resto del Worker ya consulta `rol`.
import { ErrorHttp } from './http.ts';

export interface Acceso {
  rol: 'admin' | 'consulta';
}

export async function autorizar(_request: Request, _env: Env): Promise<Acceso> {
  return { rol: 'admin' };
}

export function exigirAdmin(acceso: Acceso): void {
  if (acceso.rol !== 'admin') throw new ErrorHttp(403, 'SIN_PERMISO', 'Solo un administrador puede hacer esta operación');
}
