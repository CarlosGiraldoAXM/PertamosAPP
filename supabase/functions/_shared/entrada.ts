import { ErrorHttp } from './http.ts';

type Objeto = Record<string, unknown>;

function invalida(mensaje: string): ErrorHttp {
  return new ErrorHttp(400, 'ENTRADA_INVALIDA', mensaje);
}

export async function leerJson(req: Request): Promise<Objeto> {
  let cuerpo: unknown;
  try {
    cuerpo = await req.json();
  } catch {
    throw invalida('El cuerpo debe ser JSON');
  }
  if (typeof cuerpo !== 'object' || cuerpo === null || Array.isArray(cuerpo)) throw invalida('El cuerpo debe ser un objeto JSON');
  return cuerpo as Objeto;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

export function uuid(o: Objeto, campo: string): string {
  const v = o[campo];
  if (typeof v !== 'string' || !UUID.test(v)) throw invalida(`"${campo}" debe ser un UUID`);
  return v;
}

/** Entero seguro. Los rangos de negocio los valida core. */
export function entero(o: Objeto, campo: string): number {
  const v = o[campo];
  if (typeof v !== 'number' || !Number.isSafeInteger(v)) throw invalida(`"${campo}" debe ser un número entero`);
  return v;
}

export function enteroONull(o: Objeto, campo: string): number | null {
  return o[campo] === undefined || o[campo] === null ? null : entero(o, campo);
}

/** Formato YYYY-MM-DD; que la fecha exista lo valida core. */
export function fecha(o: Objeto, campo: string): string {
  const v = o[campo];
  if (typeof v !== 'string' || !FECHA.test(v)) throw invalida(`"${campo}" debe ser una fecha YYYY-MM-DD`);
  return v;
}

export function fechaOpcional(o: Objeto, campo: string): string | null {
  return o[campo] === undefined || o[campo] === null ? null : fecha(o, campo);
}

export function textoOpcional(o: Objeto, campo: string, max = 500): string | null {
  const v = o[campo];
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string' || v.length > max) throw invalida(`"${campo}" debe ser texto de hasta ${max} caracteres`);
  const limpio = v.trim();
  return limpio === '' ? null : limpio;
}

export function booleano(o: Objeto, campo: string): boolean {
  const v = o[campo];
  if (v === undefined || v === null) return false;
  if (typeof v !== 'boolean') throw invalida(`"${campo}" debe ser true o false`);
  return v;
}

export function lista(o: Objeto, campo: string): Objeto[] {
  const v = o[campo];
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'object' || x === null || Array.isArray(x))) {
    throw invalida(`"${campo}" debe ser una lista de objetos`);
  }
  return v as Objeto[];
}
