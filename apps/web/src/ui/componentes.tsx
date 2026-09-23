import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { escribirPesos, pesos } from '../lib/formato.ts';

export function Pantalla({
  titulo,
  subtitulo,
  volver,
  acciones,
  children,
}: {
  titulo: string;
  subtitulo?: string | undefined;
  volver?: string;
  acciones?: ReactNode;
  children: ReactNode;
}) {
  const navegar = useNavigate();
  return (
    <div className="mx-auto min-h-dvh max-w-2xl pb-24">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 px-4 pt-[max(env(safe-area-inset-top),0.75rem)] pb-3 backdrop-blur">
        <div className="flex items-center gap-2">
          {volver && (
            <button
              type="button"
              onClick={() => navegar(volver)}
              className="-ml-2 rounded-full p-2 text-slate-500 hover:bg-slate-100"
              aria-label="Volver"
            >
              ←
            </button>
          )}
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-semibold text-slate-900">{titulo}</h1>
            {subtitulo && <p className="truncate text-sm text-slate-500">{subtitulo}</p>}
          </div>
          {acciones}
        </div>
      </header>
      <main className="space-y-4 px-4 py-4">{children}</main>
    </div>
  );
}

export function Tarjeta({ titulo, children, className = '' }: { titulo?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 ${className}`}>
      {titulo && <h2 className="mb-3 text-sm font-semibold tracking-wide text-slate-500 uppercase">{titulo}</h2>}
      {children}
    </section>
  );
}

type Variante = 'primario' | 'secundario' | 'peligro';
const VARIANTES: Record<Variante, string> = {
  primario: 'bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-emerald-300',
  secundario: 'bg-white text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50 disabled:text-slate-400',
  peligro: 'bg-rose-600 text-white hover:bg-rose-700 disabled:bg-rose-300',
};

export function Boton({
  variante = 'primario',
  cargando = false,
  className = '',
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variante?: Variante; cargando?: boolean }) {
  return (
    <button
      type="button"
      {...props}
      disabled={props.disabled || cargando}
      className={`inline-flex min-h-11 items-center justify-center rounded-xl px-4 py-2 font-medium transition ${VARIANTES[variante]} ${className}`}
    >
      {cargando ? 'Procesando…' : children}
    </button>
  );
}

const ESTILO_INPUT =
  'w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-base text-slate-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 disabled:bg-slate-100';

export function Campo({
  etiqueta,
  ayuda,
  className = '',
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { etiqueta: string; ayuda?: ReactNode }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-sm font-medium text-slate-700">{etiqueta}</span>
      <input {...props} className={ESTILO_INPUT} />
      {ayuda && <span className="mt-1 block text-xs text-slate-500">{ayuda}</span>}
    </label>
  );
}

/** Campo de pesos: muestra separadores de miles mientras se escribe; `valor` es el texto crudo. */
export function CampoPesos({
  etiqueta,
  valor,
  onCambio,
  ayuda,
  autoFocus,
}: {
  etiqueta: string;
  valor: string;
  onCambio: (texto: string) => void;
  ayuda?: ReactNode;
  autoFocus?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{etiqueta}</span>
      <div className="relative">
        <span aria-hidden className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-500">
          $
        </span>
        <input
          inputMode="numeric"
          autoFocus={autoFocus}
          value={escribirPesos(valor)}
          onChange={(e) => onCambio(e.target.value)}
          className={`${ESTILO_INPUT} pl-7 tabular-nums`}
        />
      </div>
      {ayuda && <span className="mt-1 block text-xs text-slate-500">{ayuda}</span>}
    </label>
  );
}

export function Selector({
  etiqueta,
  valor,
  onCambio,
  opciones,
}: {
  etiqueta: string;
  valor: string;
  onCambio: (v: string) => void;
  opciones: { valor: string; texto: string }[];
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{etiqueta}</span>
      <select value={valor} onChange={(e) => onCambio(e.target.value)} className={ESTILO_INPUT}>
        {opciones.map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.texto}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Aviso({ tipo = 'error', children }: { tipo?: 'error' | 'info' | 'ok' | 'alerta'; children: ReactNode }) {
  const estilos = {
    error: 'bg-rose-50 text-rose-800 ring-rose-200',
    info: 'bg-sky-50 text-sky-800 ring-sky-200',
    ok: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
    alerta: 'bg-amber-50 text-amber-800 ring-amber-200',
  }[tipo];
  return <div className={`rounded-xl px-4 py-3 text-sm ring-1 ${estilos}`}>{children}</div>;
}

export function Cargando() {
  return <p className="py-10 text-center text-slate-500">Cargando…</p>;
}

/** Fila etiqueta / valor alineada a la derecha, para montos. */
export function Fila({ etiqueta, children, fuerte = false }: { etiqueta: ReactNode; children: ReactNode; fuerte?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 py-1 ${fuerte ? 'font-semibold text-slate-900' : 'text-slate-700'}`}>
      <span className="text-sm">{etiqueta}</span>
      <span className="text-right tabular-nums">{children}</span>
    </div>
  );
}

/** Monto redondeado a cobrar con la cifra exacta al lado (SPEC: siempre se muestra la exacta). */
export function Cuota({ redondeada, exacta, grande = false }: { redondeada: number; exacta: number; grande?: boolean }) {
  return (
    <span className="inline-flex flex-col items-end">
      <span className={`tabular-nums ${grande ? 'text-2xl font-bold text-slate-900' : 'font-semibold'}`}>{pesos(redondeada)}</span>
      {redondeada !== exacta && <span className="text-xs text-slate-500 tabular-nums">exacta {pesos(exacta)}</span>}
    </span>
  );
}

export function Etiqueta({ color, children }: { color: 'verde' | 'gris' | 'rojo' | 'ambar'; children: ReactNode }) {
  const c = {
    verde: 'bg-emerald-100 text-emerald-800',
    gris: 'bg-slate-100 text-slate-700',
    rojo: 'bg-rose-100 text-rose-800',
    ambar: 'bg-amber-100 text-amber-800',
  }[color];
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${c}`}>{children}</span>;
}
