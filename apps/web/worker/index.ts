// API del sistema de préstamos. El mismo Worker sirve la app (archivos
// estáticos) y atiende /api/*; ver wrangler.jsonc.
import { autorizar, exigirAdmin, type Acceso } from './acceso.ts';
import * as entrada from './entrada.ts';
import { ErrorHttp, json, responderError } from './http.ts';
import { crearPrestamo, liquidarPrestamo, registrarPago, reversar } from './operaciones.ts';
import { cargarPrestamo, cargarPrestamos, listarClientes, listarSocios, obtenerCliente } from './repo.ts';

function noEncontrado(): never {
  throw new ErrorHttp(404, 'RUTA_NO_EXISTE', 'Ruta no encontrada');
}

function idDeRuta(valor: string | undefined): string {
  if (!valor || !entrada.esUuid(valor)) noEncontrado();
  return valor;
}

async function crearCliente(db: D1Database, e: entrada.Objeto) {
  const id = crypto.randomUUID();
  await guardarCliente(
    db.prepare('insert into clientes (id, nombre, documento, telefono, direccion, notas) values (?, ?, ?, ?, ?, ?)'),
    [id, ...camposCliente(e)],
  );
  return obtenerCliente(db, id);
}

async function editarCliente(db: D1Database, id: string, e: entrada.Objeto) {
  await obtenerCliente(db, id);
  await guardarCliente(
    db.prepare('update clientes set nombre = ?, documento = ?, telefono = ?, direccion = ?, notas = ? where id = ?'),
    [...camposCliente(e), id],
  );
  return obtenerCliente(db, id);
}

function camposCliente(e: entrada.Objeto): (string | null)[] {
  return [
    entrada.texto(e, 'nombre'),
    entrada.textoOpcional(e, 'documento', 30),
    entrada.textoOpcional(e, 'telefono', 30),
    entrada.textoOpcional(e, 'direccion', 300),
    entrada.textoOpcional(e, 'notas', 2000),
  ];
}

async function guardarCliente(sentencia: D1PreparedStatement, valores: (string | null)[]): Promise<void> {
  try {
    await sentencia.bind(...valores).run();
  } catch (e) {
    if (e instanceof Error && e.message.includes('clientes.documento')) {
      throw new ErrorHttp(409, 'DOCUMENTO_DUPLICADO', 'Ya existe un cliente con ese documento');
    }
    throw e;
  }
}

async function crearSocio(db: D1Database, e: entrada.Objeto) {
  await db.prepare('insert into socios (id, nombre) values (?, ?)').bind(crypto.randomUUID(), entrada.texto(e, 'nombre')).run();
  return listarSocios(db);
}

async function editarSocio(db: D1Database, id: string, e: entrada.Objeto) {
  const nombre = entrada.textoOpcional(e, 'nombre', 200);
  const activo = entrada.booleanoOpcional(e, 'activo');
  const r = await db
    .prepare('update socios set nombre = coalesce(?, nombre), activo = coalesce(?, activo) where id = ?')
    .bind(nombre, activo === null ? null : activo ? 1 : 0, id)
    .run();
  if (r.meta.changes === 0) throw new ErrorHttp(404, 'SOCIO_NO_EXISTE', `No existe el socio ${id}`);
  return listarSocios(db);
}

async function enrutar(request: Request, env: Env, acceso: Acceso): Promise<unknown> {
  const url = new URL(request.url);
  const [, , recurso, id, accion, sobra] = url.pathname.split('/'); // ['', 'api', recurso, id, accion]
  if (sobra !== undefined) noEncontrado();
  const metodo = request.method;
  const db = env.DB;
  const cuerpo = () => entrada.leerJson(request);
  // Toda petición que no sea de lectura es una escritura.
  if (metodo !== 'GET') exigirAdmin(acceso);

  switch (recurso) {
    case 'socios':
      if (accion !== undefined) noEncontrado();
      if (id === undefined && metodo === 'GET') return listarSocios(db);
      if (id === undefined && metodo === 'POST') return crearSocio(db, await cuerpo());
      if (id !== undefined && metodo === 'PATCH') return editarSocio(db, idDeRuta(id), await cuerpo());
      break;

    case 'clientes':
      if (accion !== undefined) noEncontrado();
      if (id === undefined && metodo === 'GET') return listarClientes(db);
      if (id === undefined && metodo === 'POST') return crearCliente(db, await cuerpo());
      if (id !== undefined && metodo === 'GET') return obtenerCliente(db, idDeRuta(id));
      if (id !== undefined && metodo === 'PATCH') return editarCliente(db, idDeRuta(id), await cuerpo());
      break;

    case 'prestamos':
      if (id === undefined && metodo === 'GET') {
        const clienteId = url.searchParams.get('clienteId');
        return cargarPrestamos(db, clienteId ? { clienteId: idDeRuta(clienteId) } : {});
      }
      if (id === undefined && metodo === 'POST') return crearPrestamo(db, await cuerpo());
      if (id !== undefined && accion === undefined && metodo === 'GET') return cargarPrestamo(db, idDeRuta(id));
      if (id !== undefined && metodo === 'POST') {
        if (accion === 'pagos') return registrarPago(db, idDeRuta(id), await cuerpo());
        if (accion === 'liquidacion') return liquidarPrestamo(db, idDeRuta(id), await cuerpo());
        if (accion === 'reversos') return reversar(db, idDeRuta(id), await cuerpo());
      }
      break;
  }
  return noEncontrado();
}

export default {
  async fetch(request, env): Promise<Response> {
    try {
      const acceso = await autorizar(request, env);
      return json(await enrutar(request, env, acceso));
    } catch (e) {
      return responderError(e);
    }
  },
} satisfies ExportedHandler<Env>;
