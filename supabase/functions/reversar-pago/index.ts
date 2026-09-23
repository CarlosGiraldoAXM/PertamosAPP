// Reversa el último movimiento efectivo de un préstamo con un asiento espejo.
// El original no se toca: el libro es inmutable.
import { exigirAdmin, usuarioAutenticado } from '../_shared/auth.ts';
import { estadoPrestamo, reversarPago } from '../_shared/core.ts';
import { db } from '../_shared/db.ts';
import * as entrada from '../_shared/entrada.ts';
import { hoyBogota } from '../_shared/fechas.ts';
import { manejar } from '../_shared/http.ts';
import { bloquearPrestamo, cargarMovimientos, cargarPrestamo, insertarMovimiento, sincronizarEstado } from '../_shared/libro.ts';

Deno.serve(
  manejar(async (req) => {
    const usuarioId = await usuarioAutenticado(req);
    const e = await entrada.leerJson(req);
    const prestamoId = entrada.uuid(e, 'prestamoId');
    const pagoId = entrada.uuid(e, 'pagoId');
    const nota = entrada.textoOpcional(e, 'nota');
    const hoy = hoyBogota();

    return await db().begin(async (tx) => {
      await exigirAdmin(tx, usuarioId);
      const fila = await bloquearPrestamo(tx, prestamoId);
      const prestamo = await cargarPrestamo(tx, fila);
      const movimientos = await cargarMovimientos(tx, prestamoId);

      const movimiento = reversarPago(prestamo, movimientos, pagoId, hoy);
      const reversoId = await insertarMovimiento(tx, prestamoId, movimiento, {
        medio: null,
        nota,
        soportePath: null,
        creadoPor: usuarioId,
      });
      const estado = estadoPrestamo(prestamo, [...movimientos, { ...movimiento, id: reversoId }], hoy);
      const estadoPrestamoDb = await sincronizarEstado(tx, fila, estado);
      return { reversoId, movimiento, estado, estadoPrestamo: estadoPrestamoDb };
    });
  }),
);
