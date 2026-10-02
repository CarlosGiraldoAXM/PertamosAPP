import { Link, useNavigate } from 'react-router';
import { useSesion } from '../auth/Sesion.tsx';
import { cargarClientes, cargarPrestamos, cargarSocios } from '../datos/cartera.ts';
import { resumirCartera, type PrestamoConEstado } from '../datos/reportes.ts';
import { useCarga } from '../datos/useCarga.ts';
import { fechaCorta, pesos } from '../lib/formato.ts';
import { hoyBogota } from '../lib/hoy.ts';
import { Aviso, Boton, Cargando, Cuota, Etiqueta, Fila, Pantalla, Tarjeta } from '../ui/componentes.tsx';
import { BarraPartes, CifraPrincipal, COLOR, COLORES_CATEGORIA, ColumnasPorMes, Dato, Inicial, Medidor } from '../ui/graficas.tsx';

function FilaCobro({ p, atrasado }: { p: PrestamoConEstado; atrasado: boolean }) {
  const e = p.estado;
  const cobro = atrasado ? e.aCobrarHoy : e.proximoCorte!;
  return (
    <Link to={`/prestamos/${p.fila.id}`} className="flex items-center gap-3 py-3 hover:bg-slate-50">
      <Inicial nombre={p.fila.cliente_nombre} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-slate-900">{p.fila.cliente_nombre}</p>
        {atrasado ? (
          <Etiqueta color="rojo">
            {e.periodosAtrasados} {e.periodosAtrasados === 1 ? 'mes' : 'meses'} sin pagar · {e.diasAtraso} días
          </Etiqueta>
        ) : (
          <p className="text-sm text-slate-500">Corta el {fechaCorta(e.proximoCorte!.fecha)}</p>
        )}
      </div>
      <Cuota redondeada={cobro.cuotaACobrar} exacta={cobro.interesExacto} />
    </Link>
  );
}

/** Guía de primeros pasos mientras no hay préstamos. */
function PrimerosPasos({ haySocios, hayClientes }: { haySocios: boolean; hayClientes: boolean }) {
  const navegar = useNavigate();
  const pasos = [
    { hecho: haySocios, texto: 'Registra los socios', detalle: 'Los dueños de la plata.', a: '/cuenta' },
    { hecho: hayClientes, texto: 'Crea tu primer cliente', detalle: 'A quién le vas a prestar.', a: '/clientes' },
    { hecho: false, texto: 'Registra el préstamo', detalle: 'Capital, tasa y la parte de cada socio.', a: '/prestamos/nuevo' },
  ];
  const siguiente = pasos.findIndex((p) => !p.hecho);
  return (
    <Tarjeta titulo="Para empezar">
      <ol className="space-y-3">
        {pasos.map((p, i) => (
          <li key={p.texto} className="flex items-center gap-3">
            <span
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
                p.hecho ? 'bg-emerald-100 text-emerald-800' : i === siguiente ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500'
              }`}
            >
              {p.hecho ? '✓' : i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className={`font-medium ${p.hecho ? 'text-slate-400 line-through' : 'text-slate-900'}`}>{p.texto}</p>
              <p className="text-sm text-slate-500">{p.detalle}</p>
            </div>
            {i === siguiente && (
              <Boton className="min-h-9 px-3 text-sm" onClick={() => navegar(p.a)}>
                Ir
              </Boton>
            )}
          </li>
        ))}
      </ol>
    </Tarjeta>
  );
}

export function Inicio() {
  const hoy = hoyBogota();
  const { esAdmin } = useSesion();
  const navegar = useNavigate();
  const carga = useCarga(async () => {
    const [cartera, socios, clientes] = await Promise.all([cargarPrestamos(), cargarSocios(), cargarClientes()]);
    return { r: resumirCartera(cartera, socios, hoy), sinPrestamos: cartera.length === 0, haySocios: socios.length > 0, hayClientes: clientes.length > 0 };
  }, [hoy]);
  const d = carga.datos;
  const r = d?.r;

  return (
    <Pantalla titulo="Inicio" subtitulo={`Hoy, ${fechaCorta(hoy)}`}>
      {carga.cargando && !d && <Cargando />}
      {carga.error && <Aviso>{carga.error}</Aviso>}
      {d?.sinPrestamos && esAdmin && <PrimerosPasos haySocios={d.haySocios} hayClientes={d.hayClientes} />}
      {r && !d.sinPrestamos && (
        <>
          <Tarjeta>
            <CifraPrincipal
              etiqueta="Plata prestada hoy"
              valor={pesos(r.capitalEnCalle)}
              detalle={`${r.prestamosActivos} ${r.prestamosActivos === 1 ? 'préstamo activo' : 'préstamos activos'}`}
            />
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Dato etiqueta="Interés que entra por mes" valor={pesos(r.interesMensualEsperado)} />
              <Dato etiqueta="Interés atrasado por cobrar" valor={pesos(r.interesVencido)} alerta={r.interesVencido > 0} />
            </div>
          </Tarjeta>

          <Tarjeta titulo={r.atrasados.length > 0 ? `Para cobrar ya (${r.atrasados.length})` : 'Para cobrar ya'}>
            {r.atrasados.length === 0 ? (
              <p className="text-sm text-slate-500">Nadie está atrasado. 🎉</p>
            ) : (
              <div className="-my-3 divide-y divide-slate-100">
                {r.atrasados.map((p) => (
                  <FilaCobro key={p.fila.id} p={p} atrasado />
                ))}
              </div>
            )}
          </Tarjeta>

          <Tarjeta titulo={r.proximos.length > 0 ? `Cortan esta semana (${r.proximos.length})` : 'Cortan esta semana'}>
            {r.proximos.length === 0 ? (
              <p className="text-sm text-slate-500">Ningún corte en los próximos 7 días.</p>
            ) : (
              <div className="-my-3 divide-y divide-slate-100">
                {r.proximos.map((p) => (
                  <FilaCobro key={p.fila.id} p={p} atrasado={false} />
                ))}
              </div>
            )}
          </Tarjeta>

          <Tarjeta titulo="Interés cobrado">
            <ColumnasPorMes datos={r.interesPorMes} titulo="Cobrado en" />
            <div className="mt-4 border-t border-slate-100 pt-4">
              <Medidor
                valor={r.interesCobradoMes}
                total={r.interesMensualEsperado}
                etiqueta={
                  <>
                    Este mes van <strong className="text-slate-900">{pesos(r.interesCobradoMes)}</strong> de {pesos(r.interesMensualEsperado)}
                  </>
                }
              />
            </div>
          </Tarjeta>

          <Tarjeta titulo="Cómo está la plata prestada">
            <BarraPartes
              partes={[
                { nombre: 'Al día', valor: r.capitalAlDia, color: COLOR.azul },
                { nombre: 'Con pagos atrasados', valor: r.capitalAtrasado, color: COLOR.critico, simbolo: '!' },
              ]}
            />
          </Tarjeta>

          {r.socios.length > 0 && (
            <Tarjeta titulo="De quién es la plata">
              <BarraPartes partes={r.socios.map((s, i) => ({ nombre: s.nombre, valor: s.capitalVivo, color: COLORES_CATEGORIA[i] ?? COLOR.neutro }))} />
              <div className="mt-4 space-y-3 border-t border-slate-100 pt-3">
                {r.socios.map((s, i) => (
                  <div key={s.socioId}>
                    <p className="flex items-center gap-2 font-medium text-slate-900">
                      <span aria-hidden className="h-3 w-3 rounded-sm" style={{ background: COLORES_CATEGORIA[i] ?? COLOR.neutro }} />
                      {s.nombre}
                    </p>
                    <Fila etiqueta="Le entra por mes">{pesos(s.interesMensualEsperado)}</Fila>
                    <Fila etiqueta="Cobrado este mes">{pesos(s.interesCobradoMes)}</Fila>
                    <Fila etiqueta="Cobrado desde el inicio">{pesos(s.interesCobradoTotal)}</Fila>
                  </div>
                ))}
              </div>
            </Tarjeta>
          )}

          <Tarjeta titulo="Informe para el socio">
            <p className="mb-3 text-sm text-slate-600">La hoja de Excel del mes, con cada préstamo, su saldo, el interés y la parte del socio. Lista para imprimir.</p>
            <Boton variante="secundario" className="w-full" onClick={() => navegar('/informe')}>
              Ver informe del mes
            </Boton>
          </Tarjeta>

          <Tarjeta titulo="Desde el inicio">
            <Fila etiqueta="Total prestado">{pesos(r.capitalPrestadoTotal)}</Fila>
            <Fila etiqueta="Capital que ya volvió">{pesos(r.capitalRecuperado)}</Fila>
            <Fila etiqueta="Interés cobrado">{pesos(r.interesCobradoTotal)}</Fila>
          </Tarjeta>
        </>
      )}
    </Pantalla>
  );
}
