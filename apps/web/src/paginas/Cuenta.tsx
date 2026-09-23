import { useState, type FormEvent } from 'react';
import { useSesion } from '../auth/Sesion.tsx';
import { cargarSocios } from '../datos/cartera.ts';
import { useCarga } from '../datos/useCarga.ts';
import { googleHabilitado, supabase } from '../lib/supabase.ts';
import { Aviso, Boton, Campo, Cargando, Etiqueta, Fila, Pantalla, Tarjeta } from '../ui/componentes.tsx';
import { FormularioClave } from './Acceso.tsx';

function Socios() {
  const carga = useCarga(cargarSocios, []);
  const [nombre, setNombre] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  async function agregar(e: FormEvent) {
    e.preventDefault();
    if (!nombre.trim()) return;
    setCargando(true);
    setError(null);
    const { error } = await supabase.from('socios').insert({ nombre: nombre.trim() });
    setCargando(false);
    if (error) return setError(error.message);
    setNombre('');
    carga.recargar();
  }

  async function alternar(id: string, activo: boolean) {
    const { error } = await supabase.from('socios').update({ activo }).eq('id', id);
    if (error) setError(error.message);
    carga.recargar();
  }

  return (
    <Tarjeta titulo="Socios">
      <p className="mb-3 text-sm text-slate-600">
        Los dueños de la plata. En cada préstamo defines qué parte de la tasa y del capital es de cada uno.
      </p>
      {carga.cargando && !carga.datos && <Cargando />}
      {carga.datos && (
        <div className="mb-3 divide-y divide-slate-100">
          {carga.datos.length === 0 && <p className="py-2 text-sm text-slate-500">Todavía no hay socios.</p>}
          {carga.datos.map((s) => (
            <div key={s.id} className="flex items-center justify-between py-2">
              <span className={s.activo ? 'text-slate-900' : 'text-slate-400'}>{s.nombre}</span>
              <div className="flex items-center gap-2">
                {!s.activo && <Etiqueta color="gris">Inactivo</Etiqueta>}
                <button type="button" className="text-sm text-slate-500 underline" onClick={() => alternar(s.id, !s.activo)}>
                  {s.activo ? 'Desactivar' : 'Activar'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      <form onSubmit={agregar} className="flex items-end gap-2">
        <Campo etiqueta="Nuevo socio" className="flex-1" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre" />
        <Boton type="submit" cargando={cargando}>
          Agregar
        </Boton>
      </form>
      {error && (
        <div className="mt-2">
          <Aviso>{error}</Aviso>
        </div>
      )}
    </Tarjeta>
  );
}

export function Cuenta() {
  const { usuario, esAdmin, salir, recargarUsuario } = useSesion();
  const [claveCambiada, setClaveCambiada] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function vincularGoogle() {
    setError(null);
    const { error } = await supabase.auth.linkIdentity({ provider: 'google', options: { redirectTo: `${window.location.origin}/cuenta` } });
    if (error) setError(error.message);
  }

  return (
    <Pantalla titulo="Cuenta">
      <Tarjeta titulo="Usuario">
        <Fila etiqueta="Nombre">{usuario?.nombre}</Fila>
        <Fila etiqueta="Correo">{usuario?.email}</Fila>
        <Fila etiqueta="Rol">{usuario?.rol === 'admin' ? 'Administrador' : 'Consulta'}</Fila>
        {googleHabilitado && (
          <div className="mt-3">
            {usuario?.email_google ? (
              <Fila etiqueta="Google">{usuario.email_google}</Fila>
            ) : (
              <Boton variante="secundario" className="w-full" onClick={vincularGoogle}>
                Vincular cuenta de Google
              </Boton>
            )}
            {error && <Aviso>{error}</Aviso>}
          </div>
        )}
      </Tarjeta>

      {esAdmin && <Socios />}

      <Tarjeta titulo="Cambiar clave">
        {claveCambiada && (
          <div className="mb-3">
            <Aviso tipo="ok">Clave actualizada.</Aviso>
          </div>
        )}
        <FormularioClave
          alTerminar={async () => {
            setClaveCambiada(true);
            await recargarUsuario();
          }}
        />
      </Tarjeta>

      <Boton variante="secundario" className="w-full" onClick={salir}>
        Cerrar sesión
      </Boton>
    </Pantalla>
  );
}
