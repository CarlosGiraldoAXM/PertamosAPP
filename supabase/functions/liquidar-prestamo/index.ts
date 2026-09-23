// Cancelación total. Con `simular: true` devuelve la cotización (interés
// vencido + interés del mes en curso prorrateado a la fecha + capital). Para
// ejecutar hay que mandar `montoCotizado`: si el cálculo cambió, se rechaza.
import { exigirAdmin, usuarioAutenticado } from '../_shared/auth.ts';
import { aplicarLiquidacion, cotizarLiquidacion, estadoPrestamo } from '../_shared/core.ts';
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
    const simular = entrada.booleano(e, 'simular');
    const montoCotizado = simular ? null : entrada.entero(e, 'montoCotizado');
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

      if (montoCotizado === null) {
        const cotizacion = cotizarLiquidacion(prestamo, movimientos, fecha, hoy);
        return { simulado: true, cotizacion };
      }

      const movimiento = aplicarLiquidacion(prestamo, movimientos, fecha, hoy, montoCotizado);
      const pagoId = await insertarMovimiento(tx, prestamoId, movimiento, datos);
      const estado = estadoPrestamo(prestamo, [...movimientos, { ...movimiento, id: pagoId }], hoy);
      const estadoPrestamoDb = await sincronizarEstado(tx, fila, estado);
      return { pagoId, movimiento, estado, estadoPrestamo: estadoPrestamoDb };
    });
  }),
);
