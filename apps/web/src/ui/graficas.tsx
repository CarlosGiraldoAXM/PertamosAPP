// Gráficas de la app. SVG/HTML propios, sin librerías.
// Reglas que siguen: el color nunca es el único canal (siempre hay texto o un
// símbolo al lado), los valores exactos son visibles sin depender de un
// tooltip (en celular no hay hover), y las marcas son delgadas con separación
// de 2 px en vez de bordes.
import { useState, type ReactNode } from 'react';
import { mesCorto, mesLargo, pesos } from '../lib/formato.ts';

/** Paleta validada (daltonismo y contraste) sobre el blanco de las tarjetas. */
export const COLOR = {
  azul: '#2a78d6', // serie principal / categoría 1
  azulSuave: '#86b6ef', // misma rampa, para lo no seleccionado
  azulPista: '#cde2fb', // misma rampa, pista de los medidores
  naranja: '#eb6834', // categoría 2
  aqua: '#1baf7a', // categoría 3
  critico: '#d03b3b', // estado: atrasado / vencido
  bien: '#0ca30c', // estado: pagado
  neutro: '#c3c2b7',
  linea: '#e1e0d9',
};

/** Orden fijo: el color sigue al socio (por posición en la lista), no a su valor. */
export const COLORES_CATEGORIA = [COLOR.azul, COLOR.naranja, COLOR.aqua];

/** Número grande con el que abre una pantalla. Uno solo por vista. */
export function CifraPrincipal({ etiqueta, valor, detalle }: { etiqueta: string; valor: string; detalle?: ReactNode }) {
  return (
    <div>
      <p className="text-sm text-slate-500">{etiqueta}</p>
      <p className="text-4xl font-semibold tracking-tight text-slate-900">{valor}</p>
      {detalle && <p className="mt-1 text-sm text-slate-500">{detalle}</p>}
    </div>
  );
}

/** Dato suelto: etiqueta + valor. Con `alerta`, lleva símbolo además de color. */
export function Dato({ etiqueta, valor, alerta = false }: { etiqueta: string; valor: string; alerta?: boolean }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3">
      <p className="text-xs text-slate-500">{etiqueta}</p>
      <p className="mt-0.5 flex items-center gap-1.5 text-lg font-semibold text-slate-900">
        {alerta && (
          <span
            aria-hidden
            className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold text-white"
            style={{ background: COLOR.critico }}
          >
            !
          </span>
        )}
        {valor}
      </p>
    </div>
  );
}

/** Avance de `valor` sobre `total`. La pista es un paso más claro del mismo color. */
export function Medidor({ valor, total, etiqueta }: { valor: number; total: number; etiqueta: ReactNode }) {
  const pct = total > 0 ? Math.min(100, Math.round((valor / total) * 100)) : 0;
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
        <span className="text-slate-600">{etiqueta}</span>
        <span className="font-semibold text-slate-900 tabular-nums">{pct} %</span>
      </div>
      <div
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        className="h-2 overflow-hidden rounded-full"
        style={{ background: COLOR.azulPista }}
      >
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: COLOR.azul }} />
      </div>
    </div>
  );
}

export interface Parte {
  nombre: string;
  valor: number;
  color: string;
  /** Símbolo que acompaña al color cuando la parte es un estado (ej. atrasado). */
  simbolo?: string;
}

/**
 * Parte del todo: una barra horizontal partida, con su leyenda debajo. La
 * leyenda lleva nombre, valor y porcentaje en texto, así que el color solo ayuda.
 */
export function BarraPartes({ partes, formato = pesos }: { partes: Parte[]; formato?: (v: number) => string }) {
  const total = partes.reduce((s, p) => s + p.valor, 0);
  const visibles = partes.filter((p) => p.valor > 0);
  return (
    <div>
      <div className="flex h-3 gap-0.5" aria-hidden>
        {total === 0 ? (
          <div className="h-full w-full rounded-full" style={{ background: COLOR.linea }} />
        ) : (
          visibles.map((p, i) => (
            <div
              key={p.nombre}
              className={`h-full ${i === 0 ? 'rounded-l-full' : ''} ${i === visibles.length - 1 ? 'rounded-r-full' : ''}`}
              style={{ width: `${(p.valor / total) * 100}%`, background: p.color, minWidth: 4 }}
            />
          ))
        )}
      </div>
      <ul className="mt-3 space-y-1.5">
        {partes.map((p) => (
          <li key={p.nombre} className="flex items-center justify-between gap-3 text-sm">
            <span className="flex min-w-0 items-center gap-2 text-slate-700">
              <span
                aria-hidden
                className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm text-[9px] font-bold text-white"
                style={{ background: p.color }}
              >
                {p.simbolo}
              </span>
              <span className="truncate">{p.nombre}</span>
            </span>
            <span className="shrink-0 text-slate-900 tabular-nums">
              {formato(p.valor)}
              <span className="ml-2 inline-block w-10 text-right text-slate-500">{total > 0 ? Math.round((p.valor / total) * 100) : 0} %</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Columnas por mes. Al tocar (o enfocar) una columna se ve su valor exacto
 * arriba; por defecto está elegido el mes en curso.
 */
export function ColumnasPorMes({ datos, titulo }: { datos: { mes: string; total: number }[]; titulo: string }) {
  const [elegido, setElegido] = useState(datos.length - 1);
  const maximo = Math.max(...datos.map((d) => d.total), 1);
  const ALTO = 96;
  const actual = datos[elegido];

  return (
    <div>
      <p className="text-sm text-slate-500">
        {titulo} · <span className="text-slate-700">{actual ? mesLargo(actual.mes) : ''}</span>
      </p>
      <p className="text-2xl font-semibold text-slate-900">{actual ? pesos(actual.total) : '—'}</p>

      <div className="mt-3 flex items-end gap-2 border-b" style={{ height: ALTO + 1, borderColor: COLOR.neutro }}>
        {datos.map((d, i) => {
          const alto = d.total === 0 ? 2 : Math.max(4, Math.round((d.total / maximo) * ALTO));
          return (
            <button
              key={d.mes}
              type="button"
              onClick={() => setElegido(i)}
              onFocus={() => setElegido(i)}
              aria-label={`${mesLargo(d.mes)}: ${pesos(d.total)}`}
              aria-pressed={i === elegido}
              className="group flex h-full flex-1 items-end justify-center rounded-t outline-none focus-visible:bg-slate-100"
            >
              <span
                className="block w-full max-w-6 rounded-t"
                style={{ height: alto, background: i === elegido ? COLOR.azul : COLOR.azulSuave }}
              />
            </button>
          );
        })}
      </div>
      <div className="mt-1 flex gap-2" aria-hidden>
        {datos.map((d, i) => (
          <span key={d.mes} className={`flex-1 text-center text-xs ${i === elegido ? 'font-semibold text-slate-900' : 'text-slate-500'}`}>
            {mesCorto(d.mes)}
          </span>
        ))}
      </div>

      <p className="mt-2 text-xs text-slate-500" aria-hidden>
        Toca un mes para ver cuánto se cobró.
      </p>

      {/* Los mismos datos como tabla, para lectores de pantalla. */}
      <table className="sr-only">
        <caption>{titulo}</caption>
        <tbody>
          {datos.map((d) => (
            <tr key={d.mes}>
              <th scope="row">{mesLargo(d.mes)}</th>
              <td>{pesos(d.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export type EstadoMes = 'pagado' | 'vencido' | 'curso';

const ESTILO_MES: Record<EstadoMes, { color: string; simbolo: string; texto: string }> = {
  pagado: { color: COLOR.bien, simbolo: '✓', texto: 'Pagado' },
  vencido: { color: COLOR.critico, simbolo: '!', texto: 'Sin pagar' },
  curso: { color: COLOR.neutro, simbolo: '', texto: 'En curso' },
};

/**
 * Un cuadrito por mes del préstamo, del primero al actual. Verde y rojo no se
 * distinguen con daltonismo, así que cada estado lleva además su símbolo.
 */
export function TiraDeMeses({ meses }: { meses: { numero: number; estado: EstadoMes; detalle: string }[] }) {
  const presentes = (['pagado', 'vencido', 'curso'] as const).filter((e) => meses.some((m) => m.estado === e));
  return (
    <div>
      <ol className="flex flex-wrap gap-0.5" aria-label="Meses del préstamo">
        {meses.map((m) => {
          const e = ESTILO_MES[m.estado];
          return (
            <li
              key={m.numero}
              title={m.detalle}
              aria-label={m.detalle}
              className="flex h-6 w-6 items-center justify-center rounded text-xs font-bold text-white"
              style={{ background: e.color }}
            >
              <span aria-hidden>{e.simbolo}</span>
            </li>
          );
        })}
      </ol>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
        {presentes.map((estado) => {
          const e = ESTILO_MES[estado];
          return (
            <li key={estado} className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-sm text-[9px] font-bold text-white"
                style={{ background: e.color }}
              >
                {e.simbolo}
              </span>
              {e.texto} ({meses.filter((m) => m.estado === estado).length})
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Inicial del nombre en un círculo, para reconocer a un cliente en una lista. */
export function Inicial({ nombre }: { nombre: string }) {
  return (
    <span
      aria-hidden
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-base font-semibold text-slate-600"
    >
      {nombre.trim().charAt(0).toUpperCase() || '?'}
    </span>
  );
}
