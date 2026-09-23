import { ErrorNegocio } from './core.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/** Error con status HTTP explícito (auth, entrada inválida, no encontrado). */
export class ErrorHttp extends Error {
  constructor(
    readonly status: number,
    readonly codigo: string,
    mensaje: string,
  ) {
    super(mensaje);
  }
}

function responder(status: number, cuerpo: unknown): Response {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function error(status: number, codigo: string, mensaje: string): Response {
  return responder(status, { error: { codigo, mensaje } });
}

// Violaciones de invariantes de la base: si llegan acá, core dejó pasar algo.
const CODIGOS_INVARIANTE = new Set(['23514', '23505', '23503', '42501']);

/** Envuelve un handler: CORS, solo POST, y traducción uniforme de errores. */
export function manejar(fn: (req: Request) => Promise<unknown>): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method !== 'POST') return error(405, 'METODO_NO_PERMITIDO', 'Solo se acepta POST');
    try {
      return responder(200, await fn(req));
    } catch (e) {
      if (e instanceof ErrorHttp) return error(e.status, e.codigo, e.message);
      if (e instanceof ErrorNegocio) return error(422, e.codigo, e.message);
      const pg = e as { code?: string; message?: string };
      if (pg.code && CODIGOS_INVARIANTE.has(pg.code)) {
        console.error('Invariante de la base violada', e);
        return error(409, 'INVARIANTE_VIOLADA', pg.message ?? 'La base rechazó la operación');
      }
      console.error('Error inesperado', e);
      return error(500, 'ERROR_INTERNO', 'Error inesperado. Revisa los logs de la función.');
    }
  };
}
