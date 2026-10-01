// Lecturas de D1. Solo arma filas; ningún cálculo financiero vive acá.
import type { Cliente, PagoFila, PrestamoDatos, PrestamoFila, Socio } from '../compartido/api.ts';
import { ErrorHttp } from './http.ts';

export async function listarSocios(db: D1Database): Promise<Socio[]> {
  const { results } = await db.prepare('select id, nombre, activo from socios order by nombre, id').all<{ id: string; nombre: string; activo: number }>();
  return results.map((s) => ({ id: s.id, nombre: s.nombre, activo: s.activo === 1 }));
}

const COLUMNAS_CLIENTE = 'id, nombre, documento, telefono, direccion, notas';

export async function listarClientes(db: D1Database): Promise<Cliente[]> {
  const { results } = await db.prepare(`select ${COLUMNAS_CLIENTE} from clientes order by nombre collate nocase, id`).all<Cliente>();
  return results;
}

export async function obtenerCliente(db: D1Database, id: string): Promise<Cliente> {
  const cliente = await db.prepare(`select ${COLUMNAS_CLIENTE} from clientes where id = ?`).bind(id).first<Cliente>();
  if (!cliente) throw new ErrorHttp(404, 'CLIENTE_NO_EXISTE', `No existe el cliente ${id}`);
  return cliente;
}

type Filtro = { prestamoId: string } | { clienteId: string } | Record<string, never>;

/**
 * Préstamos con su libro completo. Sin filtro trae toda la cartera. Las cinco
 * lecturas van en un solo batch: una ida a la base y una foto coherente.
 */
export async function cargarPrestamos(db: D1Database, filtro: Filtro = {}): Promise<PrestamoDatos[]> {
  // El filtro sale de una lista fija de condiciones; el valor siempre va enlazado.
  const [donde, valor] =
    'prestamoId' in filtro ? ['where p.id = ?1', filtro.prestamoId] : 'clienteId' in filtro ? ['where p.cliente_id = ?1', filtro.clienteId] : ['', null];
  const q = (sql: string) => (valor === null ? db.prepare(sql) : db.prepare(sql).bind(valor));

  const [prestamos, socios, pagos, aplicaciones, repartos] = await db.batch([
    q(`select p.id, p.cliente_id, c.nombre as cliente_nombre, c.documento as cliente_documento, p.capital_inicial, p.tasa_mensual_bp, p.fecha_desembolso,
              p.plazo_meses, p.estado, p.notas, p.created_at
       from prestamos p join clientes c on c.id = p.cliente_id ${donde}
       order by p.fecha_desembolso desc, p.id`),
    q(`select ps.prestamo_id, ps.socio_id, ps.tasa_bp, ps.aporte_capital
       from prestamo_socios ps join prestamos p on p.id = ps.prestamo_id ${donde}
       order by ps.socio_id`),
    q(`select pa.id, pa.prestamo_id, pa.numero, pa.tipo, pa.fecha, pa.monto, pa.medio, pa.nota, pa.reversa_de, pa.created_at
       from pagos pa join prestamos p on p.id = pa.prestamo_id ${donde}
       order by pa.prestamo_id, pa.numero`),
    q(`select a.id, a.pago_id, a.periodo, a.a_interes, a.a_capital
       from aplicaciones a join pagos pa on pa.id = a.pago_id join prestamos p on p.id = pa.prestamo_id ${donde}
       order by a.periodo is null, a.periodo, a.id`),
    q(`select r.aplicacion_id, r.socio_id, r.interes, r.capital
       from reparto_socios r join aplicaciones a on a.id = r.aplicacion_id
       join pagos pa on pa.id = a.pago_id join prestamos p on p.id = pa.prestamo_id ${donde}
       order by r.socio_id`),
  ]);

  type FilaSocio = { prestamo_id: string } & PrestamoFila['socios'][number];
  type FilaAplicacion = { pago_id: string } & Omit<PagoFila['aplicaciones'][number], 'reparto'>;
  type FilaReparto = { aplicacion_id: string } & PagoFila['aplicaciones'][number]['reparto'][number];

  const agrupar = <T, K extends keyof T>(filas: T[], clave: K): Map<T[K], T[]> => {
    const mapa = new Map<T[K], T[]>();
    for (const f of filas) {
      const lista = mapa.get(f[clave]);
      if (lista) lista.push(f);
      else mapa.set(f[clave], [f]);
    }
    return mapa;
  };
  const sociosPor = agrupar(socios!.results as FilaSocio[], 'prestamo_id');
  const pagosPor = agrupar(pagos!.results as Omit<PagoFila, 'aplicaciones'>[], 'prestamo_id');
  const aplicacionesPor = agrupar(aplicaciones!.results as FilaAplicacion[], 'pago_id');
  const repartosPor = agrupar(repartos!.results as FilaReparto[], 'aplicacion_id');

  return (prestamos!.results as Omit<PrestamoFila, 'socios'>[]).map((p) => ({
    fila: {
      ...p,
      socios: (sociosPor.get(p.id) ?? []).map(({ socio_id, tasa_bp, aporte_capital }) => ({ socio_id, tasa_bp, aporte_capital })),
    },
    pagos: (pagosPor.get(p.id) ?? []).map((pago) => ({
      ...pago,
      aplicaciones: (aplicacionesPor.get(pago.id) ?? []).map(({ id, periodo, a_interes, a_capital }) => ({
        id,
        periodo,
        a_interes,
        a_capital,
        reparto: (repartosPor.get(id) ?? []).map(({ socio_id, interes, capital }) => ({ socio_id, interes, capital })),
      })),
    })),
  }));
}

export async function cargarPrestamo(db: D1Database, id: string): Promise<PrestamoDatos> {
  const [datos] = await cargarPrestamos(db, { prestamoId: id });
  if (!datos) throw new ErrorHttp(404, 'PRESTAMO_NO_EXISTE', `No existe el préstamo ${id}`);
  return datos;
}
