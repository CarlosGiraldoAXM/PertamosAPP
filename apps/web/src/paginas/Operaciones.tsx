// Registrar pago y cancelación total. La imputación se calcula en el navegador
// con el mismo core que usa la Edge Function, para mostrarla ANTES de confirmar;
// al confirmar, la función la vuelve a calcular con el préstamo bloqueado.
import {
  aplicarPago,
  cotizarLiquidacion,
  ErrorNegocio,
  estadoPrestamo,
  type Aplicacion,
  type CotizacionLiquidacion,
  type MovimientoNuevo,
} from '@prestamos/core';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { cargarPrestamo } from '../datos/cartera.ts';
import { conEstado } from '../datos/reportes.ts';
import { useCarga } from '../datos/useCarga.ts';
import { invocar } from '../lib/funciones.ts';
import { fechaCorta, leerPesos, pesos } from '../lib/formato.ts';
import { hoyBogota } from '../lib/hoy.ts';
import { Aviso, Boton, Campo, CampoPesos, Cargando, Cuota, Fila, Pantalla, Selector, Tarjeta } from '../ui/componentes.tsx';

const MEDIOS = ['Efectivo', 'Nequi', 'Daviplata', 'Transferencia', 'Otro'].map((m) => ({ valor: m, texto: m }));

function Imputacion({ aplicaciones }: { aplicaciones: Aplicacion[] }) {
  return (
    <>
      {aplicaciones.map((a, i) =>
        a.periodo !== null ? (
          <Fila key={i} etiqueta={`Interés del mes ${a.periodo}`}>
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

export function RegistrarPago() {
  const { id, hoy, carga } = usePrestamo();
  const navegar = useNavigate();
  const p = carga.datos;
  const [fecha, setFecha] = useState(hoy);
  const [monto, setMonto] = useState('');
  const [medio, setMedio] = useState('Efectivo');
  const [nota, setNota] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  // Monto sugerido: lo vencido redondeado, o si está al día, la cuota del próximo corte.
  useEffect(() => {
    if (!p) return;
    const e = p.estado;
    const sugerido = e.aCobrarHoy.cuotaACobrar > 0 ? e.aCobrarHoy.cuotaACobrar : (e.proximoCorte?.cuotaACobrar ?? 0);
    setMonto(sugerido > 0 ? String(sugerido) : '');
  }, [p]);

  const montoN = leerPesos(monto);
  const vista = useMemo((): { movimiento: MovimientoNuevo; saldoDespues: number } | { problema: string } | null => {
    if (!p || !montoN) return null;
    try {
      const movimiento = aplicarPago(p.prestamo, p.movimientos, { fecha, monto: montoN }, hoy);
      const despues = estadoPrestamo(p.prestamo, [...p.movimientos, { ...movimiento, id: 'vista-previa' }], hoy);
      return { movimiento, saldoDespues: despues.saldoCapital };
    } catch (e) {
      return { problema: e instanceof ErrorNegocio ? e.message : String(e) };
    }
  }, [p, montoN, fecha, hoy]);

  async function confirmar() {
    if (!vista || 'problema' in vista || !montoN) return;
    setEnviando(true);
    setError(null);
    try {
      await invocar('registrar-pago', { prestamoId: id, fecha, monto: montoN, medio, nota: nota.trim() || null });
      navegar(`/prestamos/${id}`, { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setEnviando(false);
    }
  }

  const e = p?.estado;
  return (
    <Pantalla titulo="Registrar pago" subtitulo={p?.fila.clientes?.nombre} volver={`/prestamos/${id}`}>
      {carga.cargando && !p && <Cargando />}
      {carga.error && <Aviso>{carga.error}</Aviso>}
      {p && e && (
        <>
          <Tarjeta>
            <Fila etiqueta="Debe de capital">{pesos(e.saldoCapital)}</Fila>
            {e.aCobrarHoy.interesExacto > 0 && (
              <Fila etiqueta="Interés vencido">
                <Cuota redondeada={e.aCobrarHoy.cuotaACobrar} exacta={e.aCobrarHoy.interesExacto} />
              </Fila>
            )}
            {e.proximoCorte && (
              <Fila etiqueta={`Corte del ${fechaCorta(e.proximoCorte.fecha)}`}>
                <Cuota redondeada={e.proximoCorte.cuotaACobrar} exacta={e.proximoCorte.interesExacto} />
              </Fila>
            )}
          </Tarjeta>

          <Tarjeta titulo="Pago">
            <div className="space-y-3">
              <CampoPesos etiqueta="Monto recibido" valor={monto} onCambio={setMonto} autoFocus />
              <Campo etiqueta="Fecha del pago" type="date" max={hoy} value={fecha} onChange={(ev) => setFecha(ev.target.value)} />
              <Selector etiqueta="Medio" valor={medio} onCambio={setMedio} opciones={MEDIOS} />
              <Campo etiqueta="Nota (opcional)" value={nota} onChange={(ev) => setNota(ev.target.value)} />
            </div>
          </Tarjeta>

          <Tarjeta titulo="Así se imputa">
            {!vista && <p className="text-sm text-slate-500">Escribe el monto.</p>}
            {vista && 'problema' in vista && <Aviso>{vista.problema}</Aviso>}
            {vista && 'movimiento' in vista && (
              <>
                <Imputacion aplicaciones={vista.movimiento.aplicaciones} />
                <div className="mt-2 border-t border-slate-200 pt-2">
                  <Fila etiqueta="Queda debiendo de capital" fuerte>
                    {pesos(vista.saldoDespues)}
                  </Fila>
                </div>
              </>
            )}
          </Tarjeta>

          {error && <Aviso>{error}</Aviso>}
          <Boton className="w-full" cargando={enviando} disabled={!vista || 'problema' in vista} onClick={confirmar}>
            Confirmar pago de {montoN ? pesos(montoN) : '—'}
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
      await invocar('liquidar-prestamo', {
        prestamoId: id,
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
    <Pantalla titulo="Cancelar todo" subtitulo={p?.fila.clientes?.nombre} volver={`/prestamos/${id}`}>
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
