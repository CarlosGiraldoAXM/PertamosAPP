// Registrar pago y cancelación total. La imputación se calcula en el navegador
// con el mismo core que usa el Worker, para mostrarla ANTES de confirmar; al
// confirmar, el Worker la vuelve a calcular sobre el libro vigente.
import {
  aplicarPago,
  cotizarLiquidacion,
  ErrorNegocio,
  estadoPrestamo,
  periodoDeFecha,
  techoMil,
  type Aplicacion,
  type CotizacionLiquidacion,
  type DestinoSobrante,
  type MovimientoNuevo,
} from '@prestamos/core';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { cargarPrestamo } from '../datos/cartera.ts';
import { conEstado, type PrestamoConEstado } from '../datos/reportes.ts';
import { useCarga } from '../datos/useCarga.ts';
import { api } from '../lib/api.ts';
import { fechaCorta, leerPesos, pesos } from '../lib/formato.ts';
import { hoyBogota } from '../lib/hoy.ts';
import { Aviso, Boton, Campo, CampoPesos, Cargando, Cuota, Fila, Pantalla, Selector, Tarjeta } from '../ui/componentes.tsx';

const MEDIOS = ['Efectivo', 'Nequi', 'Daviplata', 'Transferencia', 'Otro'].map((m) => ({ valor: m, texto: m }));

/** `mesDelPago`: el mes que corría en la fecha del pago; los posteriores son adelantos. */
function Imputacion({ aplicaciones, mesDelPago }: { aplicaciones: Aplicacion[]; mesDelPago: number }) {
  return (
    <>
      {aplicaciones.map((a, i) =>
        a.periodo !== null ? (
          <Fila key={i} etiqueta={`Interés del mes ${a.periodo}${a.periodo > mesDelPago ? ' (adelantado)' : ''}`}>
            {pesos(a.aInteres)}
          </Fila>
        ) : (
          <Fila key={i} etiqueta="Abono a capital">
            <span className="text-emerald-700">{pesos(a.aCapital)}</span>
          </Fila>
        ),
      )}
    </>
  );
}

function usePrestamo() {
  const { id = '' } = useParams();
  const hoy = hoyBogota();
  const carga = useCarga(async () => {
    const p = await cargarPrestamo(id);
    return p ? conEstado(p, hoy) : null;
  }, [id, hoy]);
  return { id, hoy, carga };
}

/** El corte vencido más antiguo que sigue sin pagar, si lo hay. */
function corteMasViejoSinPagar(p: PrestamoConEstado) {
  return p.estado.periodos.find((per) => per.vencido && per.pendiente > 0);
}

/**
 * Fecha y monto con los que arranca el formulario. Normal: hoy y lo que debe
 * hoy (o la próxima cuota). Cargando historia: el corte más antiguo sin pagar
 * y la cuota de ese mes.
 */
function sugerencia(p: PrestamoConEstado, hoy: string, historia: boolean): { fecha: string; monto: number } {
  const e = p.estado;
  const viejo = corteMasViejoSinPagar(p);
  if (historia && viejo) {
    return { fecha: viejo.fechaCorte, monto: Math.min(techoMil(viejo.pendiente), viejo.pendiente + e.saldoCapital) };
  }
  return { fecha: hoy, monto: e.aCobrarHoy.cuotaACobrar > 0 ? e.aCobrarHoy.cuotaACobrar : (e.proximoCorte?.cuotaACobrar ?? 0) };
}

export function RegistrarPago() {
  const { id, hoy, carga } = usePrestamo();
  const navegar = useNavigate();
  const p = carga.datos;
  const [fecha, setFecha] = useState(hoy);
  const [monto, setMonto] = useState('');
  const [sobrante, setSobrante] = useState<DestinoSobrante>('capital');
  const [medio, setMedio] = useState('Efectivo');
  const [nota, setNota] = useState('');
  /** Cargando pagos de fechas pasadas: cada pago guardado propone el corte siguiente. */
  const [historia, setHistoria] = useState(false);
  const [guardado, setGuardado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (!p) return;
    const s = sugerencia(p, hoy, historia);
    setFecha(s.fecha);
    setMonto(s.monto > 0 ? String(s.monto) : '');
    // Solo al cargar el préstamo o al entrar/salir del modo historia.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p, historia]);

  const montoN = leerPesos(monto);
  const vista = useMemo((): { movimiento: MovimientoNuevo; saldoDespues: number; mesDelPago: number } | { problema: string } | null => {
    if (!p || !montoN) return null;
    try {
      const movimiento = aplicarPago(p.prestamo, p.movimientos, { fecha, monto: montoN, sobrante }, hoy);
      const despues = estadoPrestamo(p.prestamo, [...p.movimientos, { ...movimiento, id: 'vista-previa' }], hoy);
      return { movimiento, saldoDespues: despues.saldoCapital, mesDelPago: periodoDeFecha(p.prestamo.fechaDesembolso, fecha) };
    } catch (e) {
      return { problema: e instanceof ErrorNegocio ? e.message : String(e) };
    }
  }, [p, montoN, fecha, sobrante, hoy]);

  async function confirmar(seguir: boolean) {
    if (!vista || 'problema' in vista || !montoN) return;
    setEnviando(true);
    setError(null);
    setGuardado(null);
    try {
      await api('POST', `/prestamos/${id}/pagos`, { fecha, monto: montoN, sobrante, medio, nota: nota.trim() || null });
      if (!seguir) return navegar(`/prestamos/${id}`, { replace: true });
      setGuardado(`Guardado el pago de ${pesos(montoN)} del ${fechaCorta(fecha)}.`);
      setNota('');
      carga.recargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setEnviando(false);
    }
  }

  const e = p?.estado;
  const viejo = p ? corteMasViejoSinPagar(p) : undefined;
  const cancelado = p?.fila.estado !== 'activo';

  return (
    <Pantalla titulo="Registrar pago" subtitulo={p?.fila.cliente_nombre} volver={`/prestamos/${id}`}>
      {carga.cargando && !p && <Cargando />}
      {carga.error && <Aviso>{carga.error}</Aviso>}
      {guardado && <Aviso tipo="ok">{guardado}</Aviso>}
      {p && e && cancelado && <Aviso tipo="info">Este préstamo ya no recibe pagos.</Aviso>}
      {p && e && !cancelado && (
        <>
          <Tarjeta>
            <Fila etiqueta="Debe de capital">{pesos(e.saldoCapital)}</Fila>
            {e.aCobrarHoy.interesExacto > 0 && (
              <Fila etiqueta={`Interés vencido (${e.periodosAtrasados} ${e.periodosAtrasados === 1 ? 'mes' : 'meses'})`}>
                <Cuota redondeada={e.aCobrarHoy.cuotaACobrar} exacta={e.aCobrarHoy.interesExacto} />
              </Fila>
            )}
            {e.interesPagadoHasta && <Fila etiqueta="Interés ya pagado hasta">{fechaCorta(e.interesPagadoHasta)}</Fila>}
            {e.proximoCorte && (
              <Fila etiqueta={`Corte del ${fechaCorta(e.proximoCorte.fecha)}`}>
                <Cuota redondeada={e.proximoCorte.cuotaACobrar} exacta={e.proximoCorte.interesExacto} />
              </Fila>
            )}
          </Tarjeta>

          {viejo && !historia && (
            <Aviso tipo="info">
              ¿Vas a registrar pagos que ya te hicieron en fechas pasadas?{' '}
              <button type="button" className="font-semibold underline" onClick={() => setHistoria(true)}>
                Empezar por el corte del {fechaCorta(viejo.fechaCorte)}
              </button>
            </Aviso>
          )}
          {historia && (
            <Aviso tipo="info">
              Cargando pagos pasados: después de cada uno te propongo el corte siguiente. Corrige la fecha y el monto si el pago real fue distinto.{' '}
              <button type="button" className="font-semibold underline" onClick={() => setHistoria(false)}>
                Volver a hoy
              </button>
            </Aviso>
          )}

          <Tarjeta titulo="Pago">
            <div className="space-y-3">
              <CampoPesos etiqueta="Monto recibido" valor={monto} onCambio={setMonto} autoFocus />
              <Campo etiqueta="Fecha del pago" type="date" max={hoy} value={fecha} onChange={(ev) => setFecha(ev.target.value)} />
              <fieldset>
                <legend className="mb-1 block text-sm font-medium text-slate-700">Si sobra después de pagar el interés</legend>
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      ['capital', 'Abonar a capital', 'Baja la deuda'],
                      ['adelantar', 'Adelantar meses', 'Paga los meses siguientes'],
                    ] as const
                  ).map(([valor, titulo, detalle]) => (
                    <label
                      key={valor}
                      className={`cursor-pointer rounded-xl border px-3 py-2 text-sm ${
                        sobrante === valor ? 'border-emerald-600 bg-emerald-50 ring-1 ring-emerald-600' : 'border-slate-300 bg-white'
                      }`}
                    >
                      <input type="radio" name="sobrante" className="sr-only" checked={sobrante === valor} onChange={() => setSobrante(valor)} />
                      <span className="block font-medium text-slate-900">{titulo}</span>
                      <span className="block text-xs text-slate-500">{detalle}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <Selector etiqueta="Medio" valor={medio} onCambio={setMedio} opciones={MEDIOS} />
              <Campo etiqueta="Nota (opcional)" value={nota} onChange={(ev) => setNota(ev.target.value)} />
            </div>
          </Tarjeta>

          <Tarjeta titulo="Así se imputa">
            {!vista && <p className="text-sm text-slate-500">Escribe el monto.</p>}
            {vista && 'problema' in vista && <Aviso>{vista.problema}</Aviso>}
            {vista && 'movimiento' in vista && (
              <>
                <Imputacion aplicaciones={vista.movimiento.aplicaciones} mesDelPago={vista.mesDelPago} />
                <div className="mt-2 border-t border-slate-200 pt-2">
                  <Fila etiqueta="Queda debiendo de capital" fuerte>
                    {pesos(vista.saldoDespues)}
                  </Fila>
                </div>
              </>
            )}
          </Tarjeta>

          {error && <Aviso>{error}</Aviso>}
          <Boton className="w-full" cargando={enviando} disabled={!vista || 'problema' in vista} onClick={() => confirmar(false)}>
            Confirmar pago de {montoN ? pesos(montoN) : '—'}
          </Boton>
          <Boton variante="secundario" className="w-full" disabled={enviando || !vista || 'problema' in vista} onClick={() => confirmar(true)}>
            Guardar y registrar otro
          </Boton>
        </>
      )}
    </Pantalla>
  );
}

export function Liquidar() {
  const { id, hoy, carga } = usePrestamo();
  const navegar = useNavigate();
  const p = carga.datos;
  const [fecha, setFecha] = useState(hoy);
  const [medio, setMedio] = useState('Efectivo');
  const [nota, setNota] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const cotizacion = useMemo((): CotizacionLiquidacion | { problema: string } | null => {
    if (!p) return null;
    try {
      return cotizarLiquidacion(p.prestamo, p.movimientos, fecha, hoy);
    } catch (e) {
      return { problema: e instanceof ErrorNegocio ? e.message : String(e) };
    }
  }, [p, fecha, hoy]);

  async function confirmar() {
    if (!cotizacion || 'problema' in cotizacion) return;
    setEnviando(true);
    setError(null);
    try {
      await api('POST', `/prestamos/${id}/liquidacion`, {
        fecha,
        montoCotizado: cotizacion.total,
        medio,
        nota: nota.trim() || null,
      });
      navegar(`/prestamos/${id}`, { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setEnviando(false);
    }
  }

  return (
    <Pantalla titulo="Cancelar todo" subtitulo={p?.fila.cliente_nombre} volver={`/prestamos/${id}`}>
      {carga.cargando && !p && <Cargando />}
      {carga.error && <Aviso>{carga.error}</Aviso>}
      {p && (
        <>
          <Tarjeta>
            <div className="space-y-3">
              <Campo etiqueta="Fecha de pago" type="date" max={hoy} value={fecha} onChange={(ev) => setFecha(ev.target.value)} />
              <Selector etiqueta="Medio" valor={medio} onCambio={setMedio} opciones={MEDIOS} />
              <Campo etiqueta="Nota (opcional)" value={nota} onChange={(ev) => setNota(ev.target.value)} />
            </div>
          </Tarjeta>
          <Tarjeta titulo="Para cancelar">
            {cotizacion && 'problema' in cotizacion && <Aviso>{cotizacion.problema}</Aviso>}
            {cotizacion && 'total' in cotizacion && (
              <>
                {cotizacion.interesVencido > 0 && <Fila etiqueta="Interés vencido">{pesos(cotizacion.interesVencido)}</Fila>}
                {cotizacion.diasEnCurso > 0 && (
                  <Fila etiqueta={`Interés de ${cotizacion.diasEnCurso} días del mes en curso`}>{pesos(cotizacion.interesEnCurso)}</Fila>
                )}
                <Fila etiqueta="Capital">{pesos(cotizacion.capital)}</Fila>
                <div className="mt-2 border-t border-slate-200 pt-2">
                  <Fila etiqueta="Total exacto" fuerte>
                    <span className="text-xl">{pesos(cotizacion.total)}</span>
                  </Fila>
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  El interés del mes en curso se cobra solo hasta el día del pago. Este total no se redondea.
                </p>
              </>
            )}
          </Tarjeta>
          {error && <Aviso>{error}</Aviso>}
          <Boton className="w-full" cargando={enviando} disabled={!cotizacion || 'problema' in cotizacion} onClick={confirmar}>
            Confirmar cancelación
          </Boton>
        </>
      )}
    </Pantalla>
  );
}
