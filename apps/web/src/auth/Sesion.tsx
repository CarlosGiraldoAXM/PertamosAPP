import type { Session } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { cargarUsuario, type Usuario } from '../datos/cartera.ts';
import { supabase } from '../lib/supabase.ts';

interface EstadoSesion {
  cargando: boolean;
  sesion: Session | null;
  /** Fila en public.usuarios; null si la cuenta no está registrada en el sistema. */
  usuario: Usuario | null;
  error: string | null;
  esAdmin: boolean;
  recargarUsuario: () => Promise<void>;
  salir: () => Promise<void>;
}

const Contexto = createContext<EstadoSesion | null>(null);

export function ProveedorSesion({ children }: { children: ReactNode }) {
  const [sesion, setSesion] = useState<Session | null>(null);
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const leerUsuario = useCallback(async (s: Session | null) => {
    setError(null);
    if (!s) {
      setUsuario(null);
      return;
    }
    try {
      setUsuario(await cargarUsuario(s.user.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSesion(data.session);
      await leerUsuario(data.session);
      setCargando(false);
    });
    const { data } = supabase.auth.onAuthStateChange((evento, s) => {
      setSesion(s);
      // Leer la fila fuera del callback: supabase-js no permite await de otras llamadas acá.
      if (evento === 'SIGNED_IN' || evento === 'SIGNED_OUT' || evento === 'USER_UPDATED') {
        setTimeout(() => void leerUsuario(s), 0);
      }
    });
    return () => data.subscription.unsubscribe();
  }, [leerUsuario]);

  const valor: EstadoSesion = {
    cargando,
    sesion,
    usuario,
    error,
    esAdmin: usuario?.rol === 'admin' && usuario.activo,
    recargarUsuario: () => leerUsuario(sesion),
    salir: async () => {
      await supabase.auth.signOut();
    },
  };
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useSesion(): EstadoSesion {
  const c = useContext(Contexto);
  if (!c) throw new Error('useSesion fuera de ProveedorSesion');
  return c;
}
