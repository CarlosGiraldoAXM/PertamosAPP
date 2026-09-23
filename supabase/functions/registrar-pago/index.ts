// Registra un pago: bloquea el préstamo, lo imputa con core (interés vencido →
// mes en curso → capital) y guarda el asiento. Con `simular: true` devuelve la
// imputación sin guardar nada, para mostrarla antes de confirmar.
import { exigirAdmin, usuarioAutenticado } from '../_shared/auth.ts';
import { aplicarPago, estadoPrestamo } from '../_shared/core.ts';
import { db } from '../_shared/db.ts';
import * as entrada from '../_shared/entrada.ts';
import { hoyBogota } from '../_shared/fechas.ts';
import { manejar } from '../_shared/http.ts';
import {
  bloquearPrestamo,
  cargarMovimientos,
  cargarPrestamo,
  exigirPrestamoActivo,
  insertarMovimiento,
  sincronizarEstado,
} from '../_shared/libro.ts';

Deno.serve(
  manejar(async (req) => {
    const usuarioId = await usuarioAutenticado(req);
    const e = await entrada.leerJson(req);
    const prestamoId = entrada.uuid(e, 'prestamoId');
    const hoy = hoyBogota();
    const fecha = entrada.fechaOpcional(e, 'fecha') ?? hoy;
    const monto = entrada.entero(e, 'monto');
    const simular = entrada.booleano(e, 'simular');
    const datos = {
      medio: entrada.textoOpcional(e, 'medio', 100),
      nota: entrada.textoOpcional(e, 'nota'),
      soportePath: entrada.textoOpcional(e, 'soportePath', 300),
      creadoPor: usuarioId,
    };

    return await db().begin(async (tx) => {
      await exigirAdmin(tx, usuarioId);
      const fila = await bloquearPrestamo(tx, prestamoId);
      exigirPrestamoActivo(fila);
      const prestamo = await cargarPrestamo(tx, fila);
      const movimientos = await cargarMovimientos(tx, prestamoId);

      const movimiento = aplicarPago(prestamo, movimientos, { fecha, monto }, hoy);
      if (simular) {
        return {
          simulado: true,
          movimiento,
          estado: estadoPrestamo(prestamo, [...movimientos, { ...movimiento, id: 'simulado' }], hoy),
        };
      }

      const pagoId = await insertarMovimiento(tx, prestamoId, movimiento, datos);
      const estado = estadoPrestamo(prestamo, [...movimientos, { ...movimiento, id: pagoId }], hoy);
      const estadoPrestamoDb = await sincronizarEstado(tx, fila, estado);
      return { pagoId, movimiento, estado, estadoPrestamo: estadoPrestamoDb };
    });
  }),
);
