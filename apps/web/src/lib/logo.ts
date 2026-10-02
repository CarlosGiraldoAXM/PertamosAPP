// El logo para los documentos que se generan en el navegador (PDF y Excel).
// Es el mismo archivo que muestra la página: public/logo.png.

export const RUTA_LOGO = '/logo.png';

export interface Logo {
  bytes: Uint8Array;
  /** Tamaño en píxeles, leído de la cabecera del PNG, para respetar la proporción. */
  ancho: number;
  alto: number;
}

let cargando: Promise<Logo | null> | undefined;

/** Devuelve null si no se pudo cargar: el documento se genera igual, sin logo. */
export function cargarLogo(): Promise<Logo | null> {
  cargando ??= (async () => {
    try {
      const r = await fetch(RUTA_LOGO);
      if (!r.ok) return null;
      const bytes = new Uint8Array(await r.arrayBuffer());
      // PNG: firma de 8 bytes, luego el bloque IHDR con ancho y alto (enteros de 4 bytes).
      const vista = new DataView(bytes.buffer);
      return { bytes, ancho: vista.getUint32(16), alto: vista.getUint32(20) };
    } catch {
      return null;
    }
  })();
  return cargando;
}
