import { useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useSesion } from '../auth/Sesion.tsx';
import {
  cargarCliente,
  cargarClientes,
  cargarClientesEliminados,
  cargarPrestamos,
  eliminarCliente,
  guardarCliente,
  restaurarCliente,
  type Cliente,
} from '../datos/cartera.ts';
import { conEstado, type PrestamoConEstado } from '../datos/reportes.ts';
import { useCarga } from '../datos/useCarga.ts';
import { fechaCorta, pesos, porcentaje } from '../lib/formato.ts';
import { hoyBogota } from '../lib/hoy.ts';
import { Aviso, Boton, Campo, Cargando, Fila, Pantalla, Tarjeta } from '../ui/componentes.tsx';
import { EtiquetaEstado } from './Prestamos.tsx';

function sinTildes(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

type DatosCliente = Omit<Cliente, 'id'>;

function FormularioCliente({
  inicial,
  alGuardar,
  alCancelar,
}: {
  inicial?: Cliente;
  alGuardar: (id: string) => void;
  alCancelar: () => void;
}) {
  const [d, setD] = useState<DatosCliente>({
    nombre: inicial?.nombre ?? '',
    documento: inicial?.documento ?? '',
    telefono: inicial?.telefono ?? '',
    direccion: inicial?.direccion ?? '',
    notas: inicial?.notas ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const campo = (k: keyof DatosCliente) => ({
    value: d[k] ?? '',
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setD({ ...d, [k]: e.target.value }),
  });

  async function guardar(e: FormEvent) {
    e.preventDefault();
    const limpio = Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v?.trim() ? v.trim() : null])) as DatosCliente;
    if (!limpio.nombre) return setError('El nombre es obligatorio');
    setCargando(true);
    setError(null);
    try {
      const guardado = await guardarCliente(limpio, inicial?.id);
      alGuardar(guardado.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setCargando(false);
    }
  }

  return (
    <form onSubmit={guardar} className="space-y-3">
      <Campo etiqueta="Nombre" {...campo('nombre')} required autoFocus />
      <Campo etiqueta="Cédula" inputMode="numeric" {...campo('documento')} />
      <Campo etiqueta="Teléfono" type="tel" {...campo('telefono')} />
      <Campo etiqueta="Dirección" {...campo('direccion')} />
      <Campo etiqueta="Notas" {...campo('notas')} />
      {error && <Aviso>{error}</Aviso>}
      <div className="flex gap-2">
        <Boton type="submit" cargando={cargando} className="flex-1">
          Guardar
        </Boton>
        <Boton variante="secundario" onClick={alCancelar}>
          Cancelar
        </Boton>
      </div>
    </form>
  );
}

export function Clientes() {
  const { esAdmin } = useSesion();
  const navegar = useNavigate();
  const [busqueda, setBusqueda] = useState('');
  const [creando, setCreando] = useState(false);
  const carga = useCarga(cargarClientes, []);
  const eliminados = useCarga(cargarClientesEliminados, []);
  const [verEliminados, setVerEliminados] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function restaurar(id: string) {
    setError(null);
    try {
      await restaurarCliente(id);
      carga.recargar();
      eliminados.recargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const filtrados = useMemo(() => {
    const q = sinTildes(busqueda.trim());
    const lista = carga.datos ?? [];
    if (!q) return lista;
    return lista.filter((c) => sinTildes(`${c.nombre} ${c.documento ?? ''} ${c.telefono ?? ''}`).includes(q));
  }, [busqueda, carga.datos]);

  return (
    <Pantalla
      titulo="Clientes"
      acciones={
        esAdmin && !creando ? (
          <Boton onClick={() => setCreando(true)} className="min-h-9 px-3 text-sm">
            + Nuevo
          </Boton>
        ) : undefined
      }
    >
      {creando && (
        <Tarjeta titulo="Nuevo cliente">
          <FormularioCliente alGuardar={(id) => navegar(`/clientes/${id}`)} alCancelar={() => setCreando(false)} />
        </Tarjeta>
      )}
      <Campo etiqueta="Buscar" placeholder="Nombre, cédula o teléfono" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
      {carga.cargando && <Cargando />}
      {carga.error && <Aviso>{carga.error}</Aviso>}
      {carga.datos && (
        <Tarjeta>
          {filtrados.length === 0 ? (
            <p className="text-sm text-slate-500">{busqueda ? 'Sin resultados.' : 'Todavía no hay clientes.'}</p>
          ) : (
            <div className="-my-3 divide-y divide-slate-100">
              {filtrados.map((c) => (
                <Link key={c.id} to={`/clientes/${c.id}`} className="block py-3 hover:bg-slate-50">
                  <p className="font-medium text-slate-900">{c.nombre}</p>
                  <p className="text-sm text-slate-500">{[c.documento && `CC ${c.documento}`, c.telefono].filter(Boolean).join(' · ') || '—'}</p>
                </Link>
              ))}
            </div>
          )}
        </Tarjeta>
      )}

      {error && <Aviso>{error}</Aviso>}
      {esAdmin && eliminados.datos && eliminados.datos.length > 0 && (
        <Tarjeta>
          <button
            type="button"
            className="flex w-full items-center justify-between text-sm text-slate-600"
            aria-expanded={verEliminados}
            onClick={() => setVerEliminados(!verEliminados)}
          >
            <span>Clientes eliminados ({eliminados.datos.length})</span>
            <span aria-hidden>{verEliminados ? '▲' : '▼'}</span>
          </button>
          {verEliminados && (
            <div className="mt-3 divide-y divide-slate-100">
              {eliminados.datos.map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-500">{c.nombre}</p>
                    <p className="text-xs text-slate-500">
                      Eliminado el {fechaCorta(c.eliminado_en.slice(0, 10))} · {c.prestamos} {c.prestamos === 1 ? 'préstamo' : 'préstamos'}
                    </p>
                  </div>
                  <Boton variante="secundario" className="min-h-9 shrink-0 px-3 text-sm" onClick={() => restaurar(c.id)}>
                    Restaurar
                  </Boton>
                </div>
              ))}
            </div>
          )}
        </Tarjeta>
      )}
    </Pantalla>
  );
}

/** Dice exactamente qué deja de verse antes de eliminar, sobre todo si hay plata prestada. */
function ConfirmarEliminacion({
  prestamos,
  eliminando,
  alConfirmar,
  alCancelar,
}: {
  prestamos: PrestamoConEstado[];
  eliminando: boolean;
  alConfirmar: () => void;
  alCancelar: () => void;
}) {
  const activos = prestamos.filter((p) => p.fila.estado === 'activo');
  const debe = activos.reduce((s, p) => s + p.estado.saldoCapital, 0);
  const pagos = prestamos.reduce((s, p) => s + p.pagos.length, 0);
  return (
    <div className="space-y-3 rounded-2xl bg-rose-50 p-4 ring-1 ring-rose-200">
      <p className="font-semibold text-rose-900">¿Eliminar este cliente?</p>
      <ul className="list-disc space-y-1 pl-5 text-sm text-rose-900">
        <li>
          Dejará de aparecer en la app junto con sus préstamos ({prestamos.length}) y sus pagos ({pagos}).
        </li>
        {activos.length > 0 && (
          <li>
            <strong>
              Todavía debe {pesos(debe)} en {activos.length === 1 ? '1 préstamo activo' : `${activos.length} préstamos activos`}.
            </strong>{' '}
            Esa plata ya no se contará en el Inicio ni en lo que hay por cobrar.
          </li>
        )}
        <li>No se borra nada: lo puedes restaurar desde Clientes → Clientes eliminados.</li>
      </ul>
      <div className="flex gap-2">
        <Boton variante="peligro" className="flex-1" cargando={eliminando} onClick={alConfirmar}>
          Sí, eliminar
        </Boton>
        <Boton variante="secundario" onClick={alCancelar}>
          Cancelar
        </Boton>
      </div>
    </div>
  );
}

export function ClienteDetalle() {
  const { id = '' } = useParams();
  const { esAdmin } = useSesion();
  const navegar = useNavigate();
  const [editando, setEditando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [eliminando, setEliminando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hoy = hoyBogota();

  async function eliminar() {
    setEliminando(true);
    setError(null);
    try {
      await eliminarCliente(id);
      navegar('/clientes', { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setEliminando(false);
    }
  }

  const carga = useCarga(async () => {
    const [cliente, prestamos] = await Promise.all([cargarCliente(id), cargarPrestamos({ clienteId: id })]);
    return { cliente, prestamos: prestamos.map((p) => conEstado(p, hoy)) };
  }, [id, hoy]);
  const c = carga.datos?.cliente;

  return (
    <Pantalla titulo={c?.nombre ?? 'Cliente'} subtitulo={c?.documento ? `CC ${c.documento}` : undefined} volver="/clientes">
      {carga.cargando && !carga.datos && <Cargando />}
      {carga.error && <Aviso>{carga.error}</Aviso>}
      {carga.datos && !c && <Aviso>No existe el cliente.</Aviso>}
      {c && (
        <>
          <Tarjeta titulo="Datos">
            {editando ? (
              <FormularioCliente
                inicial={c}
                alGuardar={() => {
                  setEditando(false);
                  carga.recargar();
                }}
                alCancelar={() => setEditando(false)}
              />
            ) : (
              <>
                <Fila etiqueta="Teléfono">{c.telefono ?? '—'}</Fila>
                <Fila etiqueta="Dirección">{c.direccion ?? '—'}</Fila>
                {c.notas && <p className="mt-2 text-sm text-slate-600">{c.notas}</p>}
                {esAdmin && (
                  <Boton variante="secundario" className="mt-3 w-full" onClick={() => setEditando(true)}>
                    Editar datos
                  </Boton>
                )}
              </>
            )}
          </Tarjeta>

          <Tarjeta titulo="Préstamos">
            {carga.datos!.prestamos.length === 0 && <p className="text-sm text-slate-500">Sin préstamos.</p>}
            <div className="-my-3 divide-y divide-slate-100">
              {carga.datos!.prestamos.map((p) => (
                <Link key={p.fila.id} to={`/prestamos/${p.fila.id}`} className="flex items-center justify-between gap-3 py-3 hover:bg-slate-50">
                  <div>
                    <p className="font-medium text-slate-900">
                      {pesos(p.prestamo.capital)} al {porcentaje(p.prestamo.tasaMensualBp)}
                    </p>
                    <p className="text-sm text-slate-500">Desde {fechaCorta(p.prestamo.fechaDesembolso)}</p>
                  </div>
                  <div className="text-right">
                    <EtiquetaEstado p={p} />
                    {p.fila.estado === 'activo' && <p className="text-sm text-slate-600 tabular-nums">Debe {pesos(p.estado.saldoCapital)}</p>}
                  </div>
                </Link>
              ))}
            </div>
            {esAdmin && (
              <Boton className="mt-4 w-full" onClick={() => navegar(`/prestamos/nuevo?cliente=${c.id}`)}>
                Nuevo préstamo
              </Boton>
            )}
          </Tarjeta>

          {esAdmin && !confirmando && (
            <button type="button" className="w-full py-2 text-sm text-rose-700 underline" onClick={() => setConfirmando(true)}>
              Eliminar cliente
            </button>
          )}
          {confirmando && (
            <ConfirmarEliminacion
              prestamos={carga.datos!.prestamos}
              eliminando={eliminando}
              alConfirmar={eliminar}
              alCancelar={() => setConfirmando(false)}
            />
          )}
          {error && <Aviso>{error}</Aviso>}
        </>
      )}
    </Pantalla>
  );
}
