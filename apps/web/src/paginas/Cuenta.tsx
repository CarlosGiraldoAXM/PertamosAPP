import { useState, type FormEvent } from 'react';
import { useSesion } from '../auth/Sesion.tsx';
import { cargarSocios, crearSocio, editarSocio } from '../datos/cartera.ts';
import { useCarga } from '../datos/useCarga.ts';
import { Aviso, Boton, Campo, Cargando, Etiqueta, Pantalla, Tarjeta } from '../ui/componentes.tsx';

function Socios({ editable }: { editable: boolean }) {
  const carga = useCarga(cargarSocios, []);
  const [nombre, setNombre] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  async function ejecutar(accion: () => Promise<unknown>) {
    setCargando(true);
    setError(null);
    try {
      await accion();
      carga.recargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCargando(false);
    }
  }

  async function agregar(e: FormEvent) {
    e.preventDefault();
    if (!nombre.trim()) return;
    await ejecutar(() => crearSocio(nombre.trim()));
    setNombre('');
  }

  return (
    <Tarjeta titulo="Socios">
      <p className="mb-3 text-sm text-slate-600">
        Los dueños de la plata. En cada préstamo defines qué parte de la tasa y del capital es de cada uno.
      </p>
      {carga.cargando && !carga.datos && <Cargando />}
      {carga.error && <Aviso>{carga.error}</Aviso>}
      {carga.datos && (
        <div className="mb-3 divide-y divide-slate-100">
          {carga.datos.length === 0 && <p className="py-2 text-sm text-slate-500">Todavía no hay socios.</p>}
          {carga.datos.map((s) => (
            <div key={s.id} className="flex items-center justify-between py-2">
              <span className={s.activo ? 'text-slate-900' : 'text-slate-400'}>{s.nombre}</span>
              <div className="flex items-center gap-2">
                {!s.activo && <Etiqueta color="gris">Inactivo</Etiqueta>}
                {editable && (
                  <button
                    type="button"
                    className="text-sm text-slate-500 underline"
                    onClick={() => ejecutar(() => editarSocio(s.id, { activo: !s.activo }))}
                  >
                    {s.activo ? 'Desactivar' : 'Activar'}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {editable && (
        <form onSubmit={agregar} className="flex items-end gap-2">
          <Campo etiqueta="Nuevo socio" className="flex-1" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre" />
          <Boton type="submit" cargando={cargando}>
            Agregar
          </Boton>
        </form>
      )}
      {error && (
        <div className="mt-2">
          <Aviso>{error}</Aviso>
        </div>
      )}
    </Tarjeta>
  );
}

export function Cuenta() {
  const { esAdmin } = useSesion();
  return (
    <Pantalla titulo="Cuenta">
      <Socios editable={esAdmin} />
      <Aviso tipo="alerta">
        Esta versión no tiene inicio de sesión: cualquiera que tenga la dirección de la app puede ver y registrar
        movimientos. No la compartas.
      </Aviso>
    </Pantalla>
  );
}
