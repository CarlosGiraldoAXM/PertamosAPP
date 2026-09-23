import { ErrorNegocio, generarPlanDePagos, validarPrestamo, type PlanDePagos, type Prestamo } from '@prestamos/core';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { cargarClientes, cargarSocios } from '../datos/cartera.ts';
import { useCarga } from '../datos/useCarga.ts';
import { invocar } from '../lib/funciones.ts';
import { fechaCorta, leerPesos, leerPorcentajeABp, pesos, porcentaje } from '../lib/formato.ts';
import { hoyBogota } from '../lib/hoy.ts';
import { Aviso, Boton, Campo, CampoPesos, Cargando, Cuota, Fila, Pantalla, Selector, Tarjeta } from '../ui/componentes.tsx';

interface FilaSocio {
  socioId: string;
  nombre: string;
  tasa: string; // % como lo escribe el usuario
  aporte: string; // pesos como texto
}

export function PrestamoNuevo() {
  const navegar = useNavigate();
  const [params] = useSearchParams();
  const hoy = hoyBogota();
  const carga = useCarga(async () => {
    const [clientes, socios] = await Promise.all([cargarClientes(), cargarSocios()]);
    return { clientes, socios: socios.filter((s) => s.activo) };
  }, []);

  const [clienteId, setClienteId] = useState(params.get('cliente') ?? '');
  const [capital, setCapital] = useState('');
  const [tasa, setTasa] = useState('');
  const [fecha, setFecha] = useState(hoy);
  const [plazo, setPlazo] = useState('');
  const [notas, setNotas] = useState('');
  const [socios, setSocios] = useState<FilaSocio[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (!carga.datos) return;
    setSocios(carga.datos.socios.map((s) => ({ socioId: s.id, nombre: s.nombre, tasa: '', aporte: '' })));
    if (!clienteId && carga.datos.clientes[0]) setClienteId(carga.datos.clientes[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carga.datos]);

  const capitalN = leerPesos(capital);
  const tasaBp = leerPorcentajeABp(tasa);
  const unSoloSocio = socios.length === 1;

  // Con un solo socio, todo es suyo: no hace falta escribir su parte.
  const participaciones = socios
    .map((s) => ({
      socioId: s.socioId,
      tasaBp: unSoloSocio ? (tasaBp ?? 0) : (leerPorcentajeABp(s.tasa || '0') ?? NaN),
      aporteCapital: unSoloSocio ? (capitalN ?? 0) : (leerPesos(s.aporte) ?? 0),
    }))
    .filter((s) => unSoloSocio || s.tasaBp > 0 || s.aporteCapital > 0 || Number.isNaN(s.tasaBp));

  const sumaTasas = participaciones.reduce((s, p) => s + (Number.isNaN(p.tasaBp) ? 0 : p.tasaBp), 0);
  const sumaAportes = participaciones.reduce((s, p) => s + p.aporteCapital, 0);

  const vista = useMemo((): { prestamo: Prestamo; plan: PlanDePagos } | { problema: string } => {
    if (!capitalN) return { problema: 'Escribe el capital' };
    if (tasaBp === null || tasaBp === 0) return { problema: 'Escribe la tasa mensual (ej. 3 o 2,5)' };
    if (participaciones.some((p) => Number.isNaN(p.tasaBp))) return { problema: 'Revisa la tasa de cada socio (ej. 1 o 1,5)' };
    const plazoN = plazo.trim() === '' ? null : Number(plazo);
    const prestamo: Prestamo = { capital: capitalN, tasaMensualBp: tasaBp, fechaDesembolso: fecha, plazoMeses: plazoN, socios: participaciones };
    try {
      validarPrestamo(prestamo);
      return { prestamo, plan: generarPlanDePagos(prestamo, { horizonteMeses: 12 }) };
    } catch (e) {
      return { problema: e instanceof ErrorNegocio ? e.message : String(e) };
    }
  }, [capitalN, tasaBp, fecha, plazo, JSON.stringify(participaciones)]);

  async function guardar(e: FormEvent) {
    e.preventDefault();
    if ('problema' in vista) return setError(vista.problema);
    if (!clienteId) return setError('Elige el cliente');
    if (fecha > hoy) return setError('El desembolso no puede ser en el futuro');
    setGuardando(true);
    setError(null);
    try {
      const r = await invocar<{ prestamoId: string }>('crear-prestamo', {
        clienteId,
        ...vista.prestamo,
        notas: notas.trim() || null,
      });
      navegar(`/prestamos/${r.prestamoId}`, { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setGuardando(false);
    }
  }

  const setSocio = (i: number, cambio: Partial<FilaSocio>) => setSocios(socios.map((s, j) => (j === i ? { ...s, ...cambio } : s)));

  return (
    <Pantalla titulo="Nuevo préstamo" volver={clienteId ? `/clientes/${clienteId}` : '/prestamos'}>
      {carga.cargando && <Cargando />}
      {carga.error && <Aviso>{carga.error}</Aviso>}
      {carga.datos && carga.datos.socios.length === 0 && (
        <Aviso tipo="alerta">Primero registra los socios en Cuenta → Socios.</Aviso>
      )}
      {carga.datos && carga.datos.clientes.length === 0 && <Aviso tipo="alerta">Primero crea el cliente en Clientes.</Aviso>}
      {carga.datos && carga.datos.socios.length > 0 && carga.datos.clientes.length > 0 && (
        <form onSubmit={guardar} className="space-y-4">
          <Tarjeta titulo="Condiciones">
            <div className="space-y-3">
              <Selector
                etiqueta="Cliente"
                valor={clienteId}
                onCambio={setClienteId}
                opciones={carga.datos.clientes.map((c) => ({ valor: c.id, texto: c.nombre }))}
              />
              <CampoPesos etiqueta="Capital" valor={capital} onCambio={setCapital} autoFocus />
              <Campo etiqueta="Tasa mensual (%)" inputMode="decimal" placeholder="3" value={tasa} onChange={(e) => setTasa(e.target.value)} />
              <Campo etiqueta="Fecha de desembolso" type="date" max={hoy} value={fecha} onChange={(e) => setFecha(e.target.value)} />
              <Campo
                etiqueta="Plazo en meses (opcional)"
                inputMode="numeric"
                placeholder="Sin plazo: capital cuando pueda"
                value={plazo}
                onChange={(e) => setPlazo(e.target.value.replace(/\D/g, ''))}
              />
              <Campo etiqueta="Notas (opcional)" value={notas} onChange={(e) => setNotas(e.target.value)} />
            </div>
          </Tarjeta>

          <Tarjeta titulo="Socios">
            {unSoloSocio ? (
              <p className="text-sm text-slate-600">
                Todo el préstamo es de <strong>{socios[0]!.nombre}</strong>.
              </p>
            ) : (
              <div className="space-y-4">
                {socios.map((s, i) => (
                  <div key={s.socioId}>
                    <p className="mb-1 font-medium text-slate-900">{s.nombre}</p>
                    <div className="grid grid-cols-2 gap-2">
                      <Campo etiqueta="Su tasa (%)" inputMode="decimal" placeholder="0" value={s.tasa} onChange={(e) => setSocio(i, { tasa: e.target.value })} />
                      <CampoPesos etiqueta="Capital que pone" valor={s.aporte} onCambio={(v) => setSocio(i, { aporte: v })} />
                    </div>
                  </div>
                ))}
                <div className="rounded-xl bg-slate-50 p-3 text-sm">
                  <Fila etiqueta="Suma de tasas">
                    <span className={sumaTasas === tasaBp ? 'text-emerald-700' : 'text-rose-700'}>
                      {porcentaje(sumaTasas)} de {tasaBp ? porcentaje(tasaBp) : '—'}
                    </span>
                  </Fila>
                  <Fila etiqueta="Suma de capital">
                    <span className={sumaAportes === capitalN ? 'text-emerald-700' : 'text-rose-700'}>
                      {pesos(sumaAportes)} de {capitalN ? pesos(capitalN) : '—'}
                    </span>
                  </Fila>
                </div>
              </div>
            )}
          </Tarjeta>

          <Tarjeta titulo="Plan de pagos">
            {'problema' in vista ? (
              <p className="text-sm text-slate-500">{vista.problema}</p>
            ) : (
              <>
                <p className="mb-2 text-sm text-slate-600">
                  {vista.prestamo.plazoMeses
                    ? `Capital al final del mes ${vista.prestamo.plazoMeses}.`
                    : 'Sin plazo: se muestran 12 meses pagando solo la cuota.'}
                </p>
                <div className="-mx-1 divide-y divide-slate-100">
                  {vista.plan.cortes.map((c) => (
                    <div key={c.numero} className="flex items-center justify-between px-1 py-2">
                      <span className="text-sm text-slate-600">
                        {c.numero}. {fechaCorta(c.fechaCorte)}
                      </span>
                      <Cuota redondeada={c.cuotaACobrar} exacta={c.interesExacto + (c.saldoFinal === 0 ? c.abonoCapital : 0)} />
                    </div>
                  ))}
                </div>
                <div className="mt-2 border-t border-slate-200 pt-2">
                  <Fila etiqueta="Interés del periodo mostrado">{pesos(vista.plan.totalInteres)}</Fila>
                  {vista.prestamo.plazoMeses && (
                    <Fila etiqueta="Total a recibir" fuerte>
                      {pesos(vista.plan.totalACobrar)}
                    </Fila>
                  )}
                </div>
              </>
            )}
          </Tarjeta>

          {error && <Aviso>{error}</Aviso>}
          <Boton type="submit" cargando={guardando} disabled={'problema' in vista} className="w-full">
            Crear préstamo
          </Boton>
        </form>
      )}
    </Pantalla>
  );
}
