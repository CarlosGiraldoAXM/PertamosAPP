// Lectura y escritura del libro contable. Solo traduce entre Postgres y los
// tipos de core; ningún cálculo financiero vive acá.
import type { EstadoFinanciero, Movimiento, MovimientoNuevo, Prestamo } from './core.ts';
import type { Tx } from './db.ts';
import { ErrorHttp } from './http.ts';

export interface FilaPrestamo {
  id: string;
  cliente_id: string;
  capital_inicial: number;
  tasa_mensual_bp: number;
  fecha_desembolso: string;
  plazo_meses: number | null;
  estado: 'activo' | 'pagado' | 'castigado';
}

/** Bloquea el préstamo hasta el fin de la transacción: serializa las operaciones sobre él. */
export async function bloquearPrestamo(tx: Tx, id: string): Promise<FilaPrestamo> {
  const [fila] = await tx<FilaPrestamo[]>`
    select id, cliente_id, capital_inicial, tasa_mensual_bp, fecha_desembolso, plazo_meses, estado
    from public.prestamos where id = ${id}
    for update`;
  if (!fila) throw new ErrorHttp(404, 'PRESTAMO_NO_EXISTE', `No existe el préstamo ${id}`);
  return fila;
}

export async function cargarPrestamo(tx: Tx, fila: FilaPrestamo): Promise<Prestamo> {
  const socios = await tx<{ socio_id: string; tasa_bp: number; aporte_capital: number }[]>`
    select socio_id, tasa_bp, aporte_capital from public.prestamo_socios
    where prestamo_id = ${fila.id} order by socio_id`;
  return {
    capital: fila.capital_inicial,
    tasaMensualBp: fila.tasa_mensual_bp,
    fechaDesembolso: fila.fecha_desembolso,
    plazoMeses: fila.plazo_meses,
    socios: socios.map((s) => ({ socioId: s.socio_id, tasaBp: s.tasa_bp, aporteCapital: s.aporte_capital })),
  };
}

/** Todos los movimientos del préstamo en orden de registro, con sus aplicaciones y repartos. */
export async function cargarMovimientos(tx: Tx, prestamoId: string): Promise<Movimiento[]> {
  const pagos = await tx<{ id: string; tipo: Movimiento['tipo']; fecha: string; monto: number; reversa_de: string | null }[]>`
    select id, tipo, fecha, monto, reversa_de from public.pagos
    where prestamo_id = ${prestamoId} order by secuencia`;
  if (pagos.length === 0) return [];

  const aplicaciones = await tx<{ id: string; pago_id: string; periodo: number | null; a_interes: number; a_capital: number }[]>`
    select a.id, a.pago_id, a.periodo, a.a_interes, a.a_capital
    from public.aplicaciones a join public.pagos p on p.id = a.pago_id
    where p.prestamo_id = ${prestamoId}
    order by p.secuencia, a.periodo nulls last, a.id`;
  const repartos = await tx<{ aplicacion_id: string; socio_id: string; interes: number; capital: number }[]>`
    select r.aplicacion_id, r.socio_id, r.interes, r.capital
    from public.reparto_socios r
    join public.aplicaciones a on a.id = r.aplicacion_id
    join public.pagos p on p.id = a.pago_id
    where p.prestamo_id = ${prestamoId}
    order by r.socio_id`;

  return pagos.map((p) => ({
    id: p.id,
    tipo: p.tipo,
    fecha: p.fecha,
    monto: p.monto,
    reversaDe: p.reversa_de,
    aplicaciones: aplicaciones
      .filter((a) => a.pago_id === p.id)
      .map((a) => ({
        periodo: a.periodo,
        aInteres: a.a_interes,
        aCapital: a.a_capital,
        reparto: repartos
          .filter((r) => r.aplicacion_id === a.id)
          .map((r) => ({ socioId: r.socio_id, interes: r.interes, capital: r.capital })),
      })),
  }));
}

export interface DatosPago {
  medio: string | null;
  nota: string | null;
  soportePath: string | null;
  creadoPor: string;
}

/** Inserta un asiento completo (pago + aplicaciones + reparto). Devuelve el id del pago. */
export async function insertarMovimiento(tx: Tx, prestamoId: string, m: MovimientoNuevo, datos: DatosPago): Promise<string> {
  const [pago] = await tx<{ id: string }[]>`
    insert into public.pagos (prestamo_id, tipo, fecha, monto, reversa_de, medio, nota, soporte_path, creado_por)
    values (${prestamoId}, ${m.tipo}, ${m.fecha}, ${m.monto}, ${m.reversaDe}, ${datos.medio}, ${datos.nota},
            ${datos.soportePath}, ${datos.creadoPor})
    returning id`;
  for (const a of m.aplicaciones) {
    const [aplicacion] = await tx<{ id: string }[]>`
      insert into public.aplicaciones (pago_id, periodo, a_interes, a_capital)
      values (${pago!.id}, ${a.periodo}, ${a.aInteres}, ${a.aCapital})
      returning id`;
    for (const r of a.reparto) {
      if (r.interes === 0 && r.capital === 0) continue;
      await tx`
        insert into public.reparto_socios (aplicacion_id, socio_id, interes, capital)
        values (${aplicacion!.id}, ${r.socioId}, ${r.interes}, ${r.capital})`;
    }
  }
  return pago!.id;
}

/** Marca el préstamo como pagado al cancelarse, o lo reactiva si un reverso lo reabre. */
export async function sincronizarEstado(tx: Tx, fila: FilaPrestamo, estado: EstadoFinanciero): Promise<FilaPrestamo['estado']> {
  const nuevo = fila.estado === 'activo' && estado.cancelado ? 'pagado' : fila.estado === 'pagado' && !estado.cancelado ? 'activo' : fila.estado;
  if (nuevo !== fila.estado) await tx`update public.prestamos set estado = ${nuevo} where id = ${fila.id}`;
  return nuevo;
}

export function exigirPrestamoActivo(fila: FilaPrestamo): void {
  if (fila.estado === 'castigado') throw new ErrorHttp(422, 'PRESTAMO_CASTIGADO', 'El préstamo está castigado; no recibe pagos');
  if (fila.estado === 'pagado') throw new ErrorHttp(422, 'PRESTAMO_CANCELADO', 'El préstamo ya está cancelado');
}
