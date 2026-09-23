import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from './supabase.ts';

/** Error devuelto por una Edge Function, con el código y mensaje de negocio. */
export class ErrorFuncion extends Error {
  constructor(
    readonly codigo: string,
    mensaje: string,
  ) {
    super(mensaje);
  }
}

/** Llama a una Edge Function con la sesión actual y traduce su error a un mensaje legible. */
export async function invocar<T>(nombre: string, cuerpo: unknown): Promise<T> {
  const { data, error } = await supabase.functions.invoke(nombre, { body: cuerpo as Record<string, unknown> });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      try {
        const j = (await error.context.json()) as { error?: { codigo: string; mensaje: string } };
        if (j.error) throw new ErrorFuncion(j.error.codigo, j.error.mensaje);
      } catch (e) {
        if (e instanceof ErrorFuncion) throw e;
      }
    }
    throw new ErrorFuncion('ERROR_RED', 'No se pudo completar la operación. Revisa la conexión e intenta de nuevo.');
  }
  return data as T;
}
