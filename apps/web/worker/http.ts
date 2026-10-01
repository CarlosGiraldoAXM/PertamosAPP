import { ErrorNegocio } from '@prestamos/core';

/** Error con status HTTP explícito (entrada inválida, no encontrado, sin permiso). */
export class ErrorHttp extends Error {
  constructor(
    readonly status: number,
    readonly codigo: string,
    mensaje: string,
  ) {
    super(mensaje);
  }
}

export function json(cuerpo: unknown, status = 200): Response {
  return Response.json(cuerpo, { status, headers: { 'Cache-Control': 'no-store' } });
}

function error(status: number, codigo: string, mensaje: string): Response {
  return json({ error: { codigo, mensaje } }, status);
}

/** Traduce cualquier error a una respuesta uniforme `{ error: { codigo, mensaje } }`. */
export function responderError(e: unknown): Response {
  if (e instanceof ErrorHttp) return error(e.status, e.codigo, e.message);
  if (e instanceof ErrorNegocio) return error(422, e.codigo, e.message);
  const mensaje = e instanceof Error ? e.message : String(e);
  // D1 reporta las violaciones de constraints y los RAISE(ABORT) de los triggers en el mensaje.
  // Si llegan acá, la base rechazó algo que core dejó pasar: es un bug o un dato manipulado.
  if (/SQLITE_CONSTRAINT|constraint failed/i.test(mensaje)) {
    console.error('Invariante de la base violada', mensaje);
    return error(409, 'INVARIANTE_VIOLADA', mensaje.replace(/^.*?:\s*/, '').replace(/: SQLITE_CONSTRAINT.*$/, ''));
  }
  console.error('Error inesperado', e);
  return error(500, 'ERROR_INTERNO', 'Error inesperado. Revisa los logs del Worker.');
}
