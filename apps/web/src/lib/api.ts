/** Error devuelto por la API, con el código y el mensaje de negocio. */
export class ErrorApi extends Error {
  constructor(
    readonly status: number,
    readonly codigo: string,
    mensaje: string,
  ) {
    super(mensaje);
  }
}

/** Llama a la API del Worker (mismo origen que la app) y traduce sus errores a mensajes legibles. */
export async function api<T>(metodo: 'GET' | 'POST' | 'PATCH', ruta: string, cuerpo?: unknown): Promise<T> {
  let r: Response;
  try {
    r = await fetch(`/api${ruta}`, {
      method: metodo,
      headers: cuerpo === undefined ? {} : { 'Content-Type': 'application/json' },
      body: cuerpo === undefined ? null : JSON.stringify(cuerpo),
    });
  } catch {
    throw new ErrorApi(0, 'ERROR_RED', 'No hay conexión. Revisa el internet e intenta de nuevo.');
  }
  const datos = (await r.json().catch(() => null)) as { error?: { codigo: string; mensaje: string } } | null;
  if (!r.ok) {
    throw new ErrorApi(r.status, datos?.error?.codigo ?? 'ERROR', datos?.error?.mensaje ?? `La operación falló (${r.status})`);
  }
  return datos as T;
}
