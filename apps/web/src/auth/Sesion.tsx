// Etapa actual: sin login (ver worker/acceso.ts). Este hook es el punto donde
// la app sabrá quién es el usuario cuando se agregue; las pantallas ya
// consultan `esAdmin` para mostrar u ocultar los botones de escritura.
export function useSesion(): { esAdmin: boolean } {
  return { esAdmin: true };
}
