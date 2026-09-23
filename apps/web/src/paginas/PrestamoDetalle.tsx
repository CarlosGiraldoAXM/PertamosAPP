import { analizarLibro } from '@prestamos/core';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useSesion } from '../auth/Sesion.tsx';
import { cargarPrestamo, cargarSocios, type PagoFila } from '../datos/cartera.ts';
import { conEstado } from '../datos/reportes.ts';
import { useCarga } from '../datos/useCarga.ts';
import { invocar } from '../lib/funciones.ts';
import { fechaCorta, pesos, porcentaje } from '../lib/formato.ts';
import { hoyBogota } from '../lib/hoy.ts';
import { Aviso, Boton, Campo, Cargando, Cuota, Etiqueta, Fila, Pantalla, Tarjeta } from '../ui/componentes.tsx';
import { EtiquetaEstado } from './Prestamos.tsx';

const TIPO: Record<PagoFila['tipo'], string> = { pago: 'Pago', liquidacion: 'Cancelación total', reverso: 'Reverso' };

function Desglose({ pago }: { pago: PagoFila }) {
  const interes = pago.aplicaciones.filter((a) => a.periodo !== null);
  const capital = pago.aplicaciones.reduce((s, a) => s + a.a_capital, 0);
  return (
    <p className="text-xs text-slate-500">
      {interes.map((a) => `Interés mes ${a.periodo}: ${pesos(a.a_interes)}`).join(' · ')}
      {interes.length > 0 && capital !== 0 && ' · '}
      {capital !== 0 && `Capital: ${pesos(capital)}`}
    </p>
  );
}

export function PrestamoDetalle() {
  const { id = '' } = useParams();
  const { esAdmin } = useSesion();
  const navegar = useNavigate();
  const hoy = hoyBogota();
  const [reversando, setReversando] = useState<string | null>(null);
  const [nota, setNota] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const carga = useCarga(async () => {
    const [p, socios] = await Promise.all([cargarPrestamo(id), cargarSocios()]);
    return { p: p ? conEstado(p, hoy) : null, nombres: new Map(socios.map((s) => [s.id, s.nombre])) };
  }, [id, hoy]);

  const p = carga.datos?.p;
  const e = p?.estado;
  const efectivos = p ? new Set(analizarLibro(p.prestamo, p.movimientos).efectivos.map((m) => m.id)) : new Set<string>();
  const ultimoEfectivo = p ? [...p.pagos].reverse().find((x) => efectivos.has(x.id)) : undefined;
  const reversados = new Set(p?.pagos.map((x) => x.reversa_de).filter(Boolean));
  const activo = p?.fila.estado === 'activo';

  async function reversar(pagoId: string) {
    setEnviando(true);
    setError(null);
    try {
      await invocar('reversar-pago', { prestamoId: id, pagoId, nota: nota.trim() || null });
      setReversando(null);
      setNota('');
      carga.recargar();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Pantalla
      titulo={p?.fila.clientes?.nombre ?? 'Préstamo'}
      subtitulo={p ? `${pesos(p.prestamo.capital)} al ${porcentaje(p.prestamo.tasaMensualBp)} mensual` : undefined}
      volver={p ? `/clientes/${p.fila.cliente_id}` : '/prestamos'}
    >
      {carga.cargando && !carga.datos && <Cargando />}
      {carga.error && <Aviso>{carga.error}</Aviso>}
      {carga.datos && !p && <Aviso>No existe el préstamo.</Aviso>}
      {p && e && (
        <>
          <Tarjeta>
            <div className="mb-3 flex items-center justify-between">
              <EtiquetaEstado p={p} />
              <span className="text-sm text-slate-500">
                Desde {fechaCorta(p.prestamo.fechaDesembolso)}
                {p.prestamo.plazoMeses ? ` · ${p.prestamo.plazoMeses} meses` : ' · sin plazo'}
              </span>
            </div>
            <Fila etiqueta="Debe de capital" fuerte>
              <span className="text-xl">{pesos(e.saldoCapital)}</span>
            </Fila>
            {e.interesVencidoPendiente > 0 && (
              <Fila etiqueta={`Interés vencido (${e.periodosAtrasados} ${e.periodosAtrasados === 1 ? 'mes' : 'meses'}, ${e.diasAtraso} días)`}>
                <span className="text-rose-700">{pesos(e.interesVencidoPendiente)}</span>
              </Fila>
            )}
            {e.aCobrarHoy.interesExacto > 0 && (
              <Fila etiqueta="Para ponerse al día hoy" fuerte>
                <Cuota redondeada={e.aCobrarHoy.cuotaACobrar} exacta={e.aCobrarHoy.interesExacto} />
              </Fila>
            )}
            {e.proximoCorte && (
              <Fila etiqueta={`Próximo corte · ${fechaCorta(e.proximoCorte.fecha)}`}>
                <Cuota redondeada={e.proximoCorte.cuotaACobrar} exacta={e.proximoCorte.interesExacto} />
              </Fila>
            )}
            {e.plazoVencido && <Aviso tipo="alerta">Venció el plazo y todavía debe capital.</Aviso>}
            {esAdmin && activo && (
              <div className="mt-4 grid grid-cols-2 gap-2">
                <Boton onClick={() => navegar(`/prestamos/${id}/pago`)}>Registrar pago</Boton>
                <Boton variante="secundario" onClick={() => navegar(`/prestamos/${id}/liquidar`)}>
                  Cancelar todo
                </Boton>
              </div>
            )}
          </Tarjeta>

          <Tarjeta titulo="Socios">
            <div className="space-y-3">
              {e.socios.map((s) => (
                <div key={s.socioId} className="rounded-xl bg-slate-50 p-3">
                  <p className="mb-1 font-medium text-slate-900">
                    {carga.datos!.nombres.get(s.socioId) ?? 'Socio'}{' '}
                    <span className="text-sm font-normal text-slate-500">
                      · {porcentaje(s.tasaBp)} · puso {pesos(s.aporteCapital)}
                    </span>
                  </p>
                  <Fila etiqueta="Interés cobrado">{pesos(s.interesCobrado)}</Fila>
                  <Fila etiqueta="Capital devuelto">{pesos(s.capitalDevuelto)}</Fila>
                  <Fila etiqueta="Capital pendiente">{pesos(s.capitalPendiente)}</Fila>
                  {s.interesVencidoPendiente > 0 && <Fila etiqueta="Interés vencido">{pesos(s.interesVencidoPendiente)}</Fila>}
                  {activo && (
                    <Fila etiqueta={p.prestamo.plazoMeses ? 'Interés por cobrar hasta el plazo' : 'Por cobrar (vencido + 12 meses)'}>
                      {pesos(s.interesProyectado)}
                    </Fila>
                  )}
                </div>
              ))}
            </div>
            {e.totalProyectadoAlFinal !== null && (
              <div className="mt-3 border-t border-slate-100 pt-2">
                <Fila etiqueta="Total que habrá recibido al terminar" fuerte>
                  {pesos(e.totalProyectadoAlFinal)}
                </Fila>
              </div>
            )}
          </Tarjeta>

          <Tarjeta titulo="Pagos">
            {p.pagos.length === 0 && <p className="text-sm text-slate-500">Todavía no hay pagos.</p>}
            {error && <Aviso>{error}</Aviso>}
            <div className="-my-3 divide-y divide-slate-100">
              {[...p.pagos].reverse().map((pago) => {
                const anulado = reversados.has(pago.id) || pago.tipo === 'reverso';
                return (
                  <div key={pago.id} className="py-3">
                    <div className="flex items-baseline justify-between gap-2">
                      <div>
                        <p className={`font-medium ${anulado ? 'text-slate-400 line-through' : 'text-slate-900'}`}>
                          {TIPO[pago.tipo]} · {fechaCorta(pago.fecha)}
                        </p>
                        {pago.medio && <p className="text-xs text-slate-500">{pago.medio}</p>}
                      </div>
                      <span className={`tabular-nums ${anulado ? 'text-slate-400' : 'font-semibold'}`}>{pesos(pago.monto)}</span>
                    </div>
                    <Desglose pago={pago} />
                    {pago.nota && <p className="mt-1 text-xs text-slate-600 italic">{pago.nota}</p>}
                    {reversados.has(pago.id) && <Etiqueta color="gris">Reversado</Etiqueta>}
                    {esAdmin && pago.id === ultimoEfectivo?.id && reversando !== pago.id && (
                      <button type="button" className="mt-1 text-xs text-rose-700 underline" onClick={() => setReversando(pago.id)}>
                        Reversar este pago
                      </button>
                    )}
                    {reversando === pago.id && (
                      <div className="mt-2 space-y-2 rounded-xl bg-rose-50 p-3">
                        <p className="text-sm text-rose-800">
                          Se registra un asiento contrario por {pesos(-pago.monto)}. El pago original queda en el historial.
                        </p>
                        <Campo etiqueta="Motivo" value={nota} onChange={(ev) => setNota(ev.target.value)} placeholder="Ej. monto equivocado" />
                        <div className="flex gap-2">
                          <Boton variante="peligro" cargando={enviando} onClick={() => reversar(pago.id)} className="flex-1">
                            Confirmar reverso
                          </Boton>
                          <Boton variante="secundario" onClick={() => setReversando(null)}>
                            No
                          </Boton>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Tarjeta>

          <Tarjeta titulo="Meses">
            <div className="-my-2 divide-y divide-slate-100">
              {[...e.periodos].reverse().map((per) => (
                <div key={per.numero} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <div>
                    <p className="text-slate-900">
                      Mes {per.numero} · corta {fechaCorta(per.fechaCorte)}
                    </p>
                    <p className="text-xs text-slate-500">sobre {pesos(per.saldoBase)}</p>
                  </div>
                  <div className="text-right">
                    <p className="tabular-nums">{pesos(per.interes)}</p>
                    {per.pendiente === 0 ? (
                      <Etiqueta color="verde">Pagado</Etiqueta>
                    ) : per.vencido ? (
                      <Etiqueta color="rojo">Debe {pesos(per.pendiente)}</Etiqueta>
                    ) : (
                      <Etiqueta color="gris">En curso</Etiqueta>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Tarjeta>
        </>
      )}
    </Pantalla>
  );
}
