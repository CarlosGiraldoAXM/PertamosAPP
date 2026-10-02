// Entregar un archivo generado en el navegador (PDF, Excel): compartirlo por el
// menú del celular o descargarlo.

function comoArchivo(blob: Blob, nombre: string): File {
  return new File([blob], nombre, { type: blob.type });
}

/** ¿Este dispositivo puede abrir el menú de compartir (WhatsApp, correo…) con el archivo? */
export function puedeCompartir(blob: Blob, nombre: string): boolean {
  return typeof navigator.canShare === 'function' && navigator.canShare({ files: [comoArchivo(blob, nombre)] });
}

/**
 * Abre el menú de compartir. Debe llamarse directo desde un toque del usuario
 * con el archivo ya generado: Safari bloquea compartir si pasa tiempo desde el toque.
 * Devuelve false si el usuario cerró el menú sin enviar.
 */
export async function compartir(blob: Blob, nombre: string): Promise<boolean> {
  try {
    await navigator.share({ files: [comoArchivo(blob, nombre)], title: nombre.replace(/\.[a-z]+$/, '') });
    return true;
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return false;
    throw e;
  }
}

export function descargar(blob: Blob, nombre: string): void {
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = nombre;
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
