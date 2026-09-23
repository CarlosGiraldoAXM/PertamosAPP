import { useCallback, useEffect, useState } from 'react';

export interface Carga<T> {
  datos: T | undefined;
  error: string | null;
  cargando: boolean;
  recargar: () => void;
}

/** Ejecuta una carga asíncrona al montar (y cuando cambian `deps`), con estado de error y recarga. */
export function useCarga<T>(fn: () => Promise<T>, deps: unknown[]): Carga<T> {
  const [datos, setDatos] = useState<T>();
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let vigente = true;
    setCargando(true);
    setError(null);
    fn()
      .then((d) => vigente && setDatos(d))
      .catch((e: unknown) => vigente && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => vigente && setCargando(false));
    return () => {
      vigente = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, version]);

  const recargar = useCallback(() => setVersion((v) => v + 1), []);
  return { datos, error, cargando, recargar };
}
