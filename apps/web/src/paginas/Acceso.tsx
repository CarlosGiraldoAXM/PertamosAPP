import { useState, type FormEvent } from 'react';
import { useSesion } from '../auth/Sesion.tsx';
import { googleHabilitado, supabase } from '../lib/supabase.ts';
import { Aviso, Boton, Campo } from '../ui/componentes.tsx';

function Marco({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-5 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <div>
          <p className="text-sm font-medium text-emerald-700">Préstamos</p>
          <h1 className="text-xl font-semibold text-slate-900">{titulo}</h1>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Login() {
  const [email, setEmail] = useState('');
  const [clave, setClave] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  async function entrar(e: FormEvent) {
    e.preventDefault();
    setCargando(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: clave });
    setCargando(false);
    if (error) setError(error.message === 'Invalid login credentials' ? 'Correo o clave incorrectos' : error.message);
  }

  async function entrarConGoogle() {
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } });
    if (error) setError(error.message);
  }

  return (
    <Marco titulo="Iniciar sesión">
      <form onSubmit={entrar} className="space-y-4">
        <Campo etiqueta="Correo" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <Campo
          etiqueta="Clave"
          type="password"
          autoComplete="current-password"
          value={clave}
          onChange={(e) => setClave(e.target.value)}
          required
        />
        {error && <Aviso>{error}</Aviso>}
        <Boton type="submit" cargando={cargando} className="w-full">
          Entrar
        </Boton>
      </form>
      {googleHabilitado && (
        <Boton variante="secundario" className="w-full" onClick={entrarConGoogle}>
          Entrar con Google
        </Boton>
      )}
    </Marco>
  );
}

/** Misma política que Auth: ≥ 10 caracteres con mayúsculas, minúsculas y números. */
export function problemaClave(clave: string): string | null {
  if (clave.length < 10) return 'Debe tener al menos 10 caracteres';
  if (!/[a-z]/.test(clave) || !/[A-Z]/.test(clave) || !/\d/.test(clave)) return 'Debe tener mayúsculas, minúsculas y números';
  return null;
}

export function FormularioClave({ alTerminar }: { alTerminar: () => Promise<void> | void }) {
  const [clave, setClave] = useState('');
  const [repetida, setRepetida] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  async function guardar(e: FormEvent) {
    e.preventDefault();
    const problema = problemaClave(clave);
    if (problema) return setError(problema);
    if (clave !== repetida) return setError('Las claves no coinciden');
    setCargando(true);
    setError(null);
    const { error } = await supabase.auth.updateUser({ password: clave });
    if (error) {
      setCargando(false);
      return setError(error.message);
    }
    await supabase.rpc('marcar_clave_cambiada');
    setCargando(false);
    setClave('');
    setRepetida('');
    await alTerminar();
  }

  return (
    <form onSubmit={guardar} className="space-y-4">
      <Campo
        etiqueta="Clave nueva"
        type="password"
        autoComplete="new-password"
        value={clave}
        onChange={(e) => setClave(e.target.value)}
        ayuda="Mínimo 10 caracteres, con mayúsculas, minúsculas y números."
      />
      <Campo etiqueta="Repite la clave" type="password" autoComplete="new-password" value={repetida} onChange={(e) => setRepetida(e.target.value)} />
      {error && <Aviso>{error}</Aviso>}
      <Boton type="submit" cargando={cargando} className="w-full">
        Guardar clave
      </Boton>
    </form>
  );
}

export function CambiarClaveObligatorio() {
  const { recargarUsuario, salir } = useSesion();
  return (
    <Marco titulo="Cambia tu clave">
      <Aviso tipo="info">Es tu primer ingreso: reemplaza la clave inicial por una que solo tú conozcas.</Aviso>
      <FormularioClave alTerminar={recargarUsuario} />
      <button type="button" onClick={salir} className="w-full text-sm text-slate-500 underline">
        Salir
      </button>
    </Marco>
  );
}

export function SinAcceso({ error }: { error: string | null }) {
  const { sesion, salir } = useSesion();
  return (
    <Marco titulo="Sin acceso">
      <Aviso tipo="alerta">
        La cuenta <strong>{sesion?.user.email}</strong> no está habilitada en el sistema.
        {error && <span className="mt-1 block">({error})</span>}
      </Aviso>
      <Boton variante="secundario" className="w-full" onClick={salir}>
        Salir
      </Boton>
    </Marco>
  );
}
