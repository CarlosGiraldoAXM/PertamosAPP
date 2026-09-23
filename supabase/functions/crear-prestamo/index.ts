// Crea un préstamo con sus socios. Las sumas de tasas y aportes las valida core
// antes de escribir, y la base las vuelve a verificar al commit.
import { exigirAdmin, usuarioAutenticado } from '../_shared/auth.ts';
import { ErrorNegocio, estadoPrestamo, generarPlanDePagos, validarPrestamo, type Prestamo } from '../_shared/core.ts';
import { db } from '../_shared/db.ts';
import * as entrada from '../_shared/entrada.ts';
import { hoyBogota } from '../_shared/fechas.ts';
import { ErrorHttp, manejar } from '../_shared/http.ts';

Deno.serve(
  manejar(async (req) => {
    const usuarioId = await usuarioAutenticado(req);
    const e = await entrada.leerJson(req);
    const clienteId = entrada.uuid(e, 'clienteId');
    const notas = entrada.textoOpcional(e, 'notas', 2000);
    const prestamo: Prestamo = {
      capital: entrada.entero(e, 'capital'),
      tasaMensualBp: entrada.entero(e, 'tasaMensualBp'),
      fechaDesembolso: entrada.fecha(e, 'fechaDesembolso'),
      plazoMeses: entrada.enteroONull(e, 'plazoMeses'),
      socios: entrada.lista(e, 'socios').map((s) => ({
        socioId: entrada.uuid(s, 'socioId'),
        tasaBp: entrada.entero(s, 'tasaBp'),
        aporteCapital: entrada.entero(s, 'aporteCapital'),
      })),
    };

    const hoy = hoyBogota();
    validarPrestamo(prestamo);
    if (prestamo.fechaDesembolso > hoy) {
      throw new ErrorNegocio('FECHA_FUTURA', `El desembolso (${prestamo.fechaDesembolso}) no puede ser posterior a hoy (${hoy})`);
    }

    return await db().begin(async (tx) => {
      await exigirAdmin(tx, usuarioId);

      const [cliente] = await tx`select id from public.clientes where id = ${clienteId}`;
      if (!cliente) throw new ErrorHttp(404, 'CLIENTE_NO_EXISTE', `No existe el cliente ${clienteId}`);

      const ids = prestamo.socios.map((s) => s.socioId);
      const activos = await tx<{ id: string }[]>`select id from public.socios where id in ${tx(ids)} and activo`;
      if (activos.length !== ids.length) {
        throw new ErrorHttp(422, 'SOCIO_INVALIDO', 'Algún socio no existe o está inactivo');
      }

      const [fila] = await tx<{ id: string }[]>`
        insert into public.prestamos (cliente_id, capital_inicial, tasa_mensual_bp, fecha_desembolso, plazo_meses, notas, creado_por)
        values (${clienteId}, ${prestamo.capital}, ${prestamo.tasaMensualBp}, ${prestamo.fechaDesembolso},
                ${prestamo.plazoMeses}, ${notas}, ${usuarioId})
        returning id`;
      for (const s of prestamo.socios) {
        await tx`
          insert into public.prestamo_socios (prestamo_id, socio_id, tasa_bp, aporte_capital)
          values (${fila!.id}, ${s.socioId}, ${s.tasaBp}, ${s.aporteCapital})`;
      }

      return {
        prestamoId: fila!.id,
        plan: generarPlanDePagos(prestamo),
        estado: estadoPrestamo(prestamo, [], hoy),
      };
    });
  }),
);
