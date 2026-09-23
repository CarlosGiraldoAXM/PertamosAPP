import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useSesion } from '../auth/Sesion.tsx';
import { cargarPrestamos } from '../datos/cartera.ts';
import { conEstado, type PrestamoConEstado } from '../datos/reportes.ts';
import { useCarga } from '../datos/useCarga.ts';
import { fechaCorta, pesos, porcentaje } from '../lib/formato.ts';
import { hoyBogota } from '../lib/hoy.ts';
import { Aviso, Boton, Cargando, Etiqueta, Pantalla, Tarjeta } from '../ui/componentes.tsx';

export function EtiquetaEstado({ p }: { p: PrestamoConEstado }) {
  if (p.fila.estado === 'pagado') return <Etiqueta color="gris">Pagado</Etiqueta>;
  if (p.fila.estado === 'castigado') return <Etiqueta color="gris">Castigado</Etiqueta>;
  if (p.estado.diasAtraso > 0) return <Etiqueta color="rojo">Atrasado {p.estado.diasAtraso} d</Etiqueta>;
  if (p.estado.plazoVencido) return <Etiqueta color="ambar">Plazo vencido</Etiqueta>;
  return <Etiqueta color="verde">Al día</Etiqueta>;
}

type Filtro = 'activos' | 'atrasados' | 'cerrados' | 'todos';

export function Prestamos() {
  const { esAdmin } = useSesion();
  const navegar = useNavigate();
  const [filtro, setFiltro] = useState<Filtro>('activos');
  const hoy = hoyBogota();
  const carga = useCarga(async () => (await cargarPrestamos()).map((p) => conEstado(p, hoy)), [hoy]);

  const lista = useMemo(() => {
    const todos = carga.datos ?? [];
    switch (filtro) {
      case 'activos':
        return todos.filter((p) => p.fila.estado === 'activo');
      case 'atrasados':
        return todos.filter((p) => p.fila.estado === 'activo' && p.estado.diasAtraso > 0);
      case 'cerrados':
        return todos.filter((p) => p.fila.estado !== 'activo');
      default:
        return todos;
    }
  }, [carga.datos, filtro]);

  return (
    <Pantalla
      titulo="Préstamos"
      acciones={
        esAdmin ? (
          <Boton onClick={() => navegar('/prestamos/nuevo')} className="min-h-9 px-3 text-sm">
            + Nuevo
          </Boton>
        ) : undefined
      }
    >
      <div className="flex gap-2 overflow-x-auto">
        {(['activos', 'atrasados', 'cerrados', 'todos'] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFiltro(f)}
            className={`rounded-full px-3 py-1.5 text-sm capitalize ${filtro === f ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200'}`}
          >
            {f}
          </button>
        ))}
      </div>
      {carga.cargando && !carga.datos && <Cargando />}
      {carga.error && <Aviso>{carga.error}</Aviso>}
      {carga.datos && (
        <Tarjeta>
          {lista.length === 0 ? (
            <p className="text-sm text-slate-500">No hay préstamos en esta vista.</p>
          ) : (
            <div className="-my-3 divide-y divide-slate-100">
              {lista.map((p) => (
                <Link key={p.fila.id} to={`/prestamos/${p.fila.id}`} className="flex items-center justify-between gap-3 py-3 hover:bg-slate-50">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-900">{p.fila.clientes?.nombre}</p>
                    <p className="text-sm text-slate-500">
                      {pesos(p.prestamo.capital)} · {porcentaje(p.prestamo.tasaMensualBp)} · {fechaCorta(p.prestamo.fechaDesembolso)}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <EtiquetaEstado p={p} />
                    {p.fila.estado === 'activo' && <p className="text-sm text-slate-700 tabular-nums">{pesos(p.estado.saldoCapital)}</p>}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </Tarjeta>
      )}
    </Pantalla>
  );
}
