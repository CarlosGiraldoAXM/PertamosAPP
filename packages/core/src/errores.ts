/**
 * Error de regla de negocio o de datos inválidos. Las Edge Functions lo
 * traducen a una respuesta 4xx con `codigo`; cualquier otro error es un bug.
 */
export class ErrorNegocio extends Error {
  readonly codigo: string;

  constructor(codigo: string, mensaje: string) {
    super(mensaje);
    this.name = 'ErrorNegocio';
    this.codigo = codigo;
  }
}
