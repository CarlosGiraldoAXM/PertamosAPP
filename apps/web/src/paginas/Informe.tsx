// Informe mensual para revisar con un socio, en la misma hoja de Excel que se
// llevaba a mano. La pantalla muestra lo mismo que va a salir en el archivo.
import { useEffect, useMemo, useState } from 'react';
import { cargarPrestamos, cargarSocios } from '../datos/cartera.ts';
import { armarInformeSocio } from '../datos/informeSocio.ts';
import { conEstado } from '../datos/reportes.ts';
import { useCarga } from '../datos/useCarga.ts';
import { compartir, descargar, puedeCompartir } from '../lib/archivos.ts';
import { generarExcelInformeSocio, nombreDelInforme } from '../lib/excelInformeSocio.ts';
import { fechaCorta, pesos, porcentaje } from '../lib/formato.ts';
import { hoyBogota } from '../lib/hoy.ts';
import { Aviso, Boton, Cargando, Fila, Pantalla, Selector, Tarjeta } from '../ui/componentes.tsx';

export function Informe() {
  const hoy = hoyBogota();
  const carga = useCarga(async () => {
    const [cartera, socios] = await Promise.all([cargarPrestamos(), cargarSocios()]);
    return { cartera: cartera.map((p) => conEstado(p, hoy)), socios: socios.filter((s) => s.activo) };
  }, [hoy]);
  const [socioId, setSocioId] = useState('');
  const [observaciones, setObservaciones] = useState('');
  const [archivo, setArchivo] = useState<{ blob: Blob; nombre: string } | null>(null);
  const [generando, setGenerando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (carga.datos && !socioId && carga.datos.socios[0]) setSocioId(carga.datos.socios[0].id);
  }, [carga.datos, socioId]);

  const socio = carga.datos?.socios.find((s) => s.id === socioId);
  const informe = useMemo(
    () => (carga.datos && socio ? armarInformeSocio(carga.datos.cartera, socio, hoy, observaciones) : null),
    [carga.datos, socio, hoy, observaciones],
  );

  // Si cambia algo del informe, el archivo generado ya no corresponde.
  useEffect(() => setArchivo(null), [informe]);

  async function generar() {
    if (!informe) return;
    setGenerando(true);
    setError(null);
    try {
      setArchivo({ blob: await generarExcelInformeSocio(informe), nombre: nombreDelInforme(informe) });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerando(false);
    }
  }

  return (
    <Pantalla titulo="Informe para el socio" subtitulo={informe?.titulo} volver="/">
      {carga.cargando && !carga.datos && <Cargando />}
      {carga.error && <Aviso>{carga.error}</Aviso>}
      {carga.datos && carga.datos.socios.length === 0 && <Aviso tipo="alerta">Primero registra los socios en Cuenta.</Aviso>}
      {carga.datos && informe && (
        <>
          <Tarjeta>
            <div className="space-y-3">
              <Selector
                etiqueta="Socio del informe"
                valor={socioId}
                onCambio={setSocioId}
                opciones={carga.datos.socios.map((s) => ({ valor: s.id, texto: s.nombre }))}
              />
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-slate-700">Observaciones</span>
                <textarea
                  rows={4}
                  value={observaciones}
                  onChange={(e) => setObservaciones(e.target.value)}
                  placeholder="Ej.: Salen dos créditos… Para el otro mes entran…"
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-base text-slate-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200"
                />
              </label>
            </div>
          </Tarjeta>

          <Tarjeta titulo={`${informe.filas.length} ${informe.filas.length === 1 ? 'préstamo activo' : 'préstamos activos'}`}>
            <Fila etiqueta="Total saldos" fuerte>
              {pesos(informe.totalSaldo)}
            </Fila>
            <Fila etiqueta="Interés del mes">{pesos(informe.totalInteres)}</Fila>
            <Fila etiqueta={`Parte de ${informe.socio}`}>{pesos(informe.totalInteresSocio)}</Fila>
          </Tarjeta>

          {archivo ? (
            <Tarjeta>
              <p className="mb-2 text-sm font-medium text-slate-900">{archivo.nombre} está listo</p>
              <div className="flex gap-2">
                {puedeCompartir(archivo.blob, archivo.nombre) && (
                  <Boton className="flex-1" onClick={() => compartir(archivo.blob, archivo.nombre).catch((e) => setError(String(e)))}>
                    Compartir
                  </Boton>
                )}
                <Boton variante="secundario" className="flex-1" onClick={() => descargar(archivo.blob, archivo.nombre)}>
                  Descargar
                </Boton>
              </div>
            </Tarjeta>
          ) : (
            <Boton className="w-full" cargando={generando} disabled={informe.filas.length === 0} onClick={generar}>
              Generar Excel
            </Boton>
          )}
          {error && <Aviso>{error}</Aviso>}

          <Tarjeta titulo="Así va a quedar la hoja">
            {informe.filas.length === 0 ? (
              <p className="text-sm text-slate-500">No hay préstamos activos.</p>
            ) : (
              <div className="-mx-4 overflow-x-auto px-4">
                <table className="w-max border-collapse text-xs tabular-nums">
                  <thead>
                    <tr className="text-left">
                      {['', 'CLIENTE', 'VEHICULO', 'PLACA', 'PRESTAMO', 'ABONO A CAP', 'SALDO', 'FECHA DE PAGO', 'TASA', 'TOTAL INTERES', informe.socio.toUpperCase(), '%'].map(
                        (t, i) => (
                          <th key={i} className="border border-slate-300 px-2 py-1 font-semibold whitespace-nowrap">
                            {t}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {informe.filas.map((f) => (
                      <tr key={f.numero}>
                        <td className="px-2 py-1 text-center font-semibold">{f.numero}</td>
                        <td className="border border-slate-300 px-2 py-1 whitespace-nowrap">{f.cliente}</td>
                        <td className="border border-slate-300 px-2 py-1 whitespace-nowrap">{f.vehiculo}</td>
                        <td className="border border-slate-300 px-2 py-1 whitespace-nowrap">{f.placa}</td>
                        <td className="border border-slate-300 px-2 py-1 text-right">{pesos(f.prestamo)}</td>
                        <td className="border border-slate-300 px-2 py-1 text-right whitespace-nowrap">
                          {f.abonos.length === 0 ? '0' : f.abonos.map((a) => a.toLocaleString('es-CO')).join(' - ')}
                        </td>
                        <td className="border border-slate-300 px-2 py-1 text-right">{pesos(f.saldo)}</td>
                        <td className="border border-slate-300 px-2 py-1 text-right whitespace-nowrap">{f.fechaPago ? fechaCorta(f.fechaPago) : ''}</td>
                        <td className="border border-slate-300 px-2 py-1 text-right">{porcentaje(f.tasaBp)}</td>
                        <td className="border border-slate-300 px-2 py-1 text-right">{pesos(f.totalInteres)}</td>
                        <td className="border border-slate-300 px-2 py-1 text-right">{pesos(f.interesSocio)}</td>
                        <td className="border border-slate-300 px-2 py-1 text-right">{porcentaje(f.socioBp)}</td>
                      </tr>
                    ))}
                    <tr className="font-semibold">
                      <td colSpan={5} />
                      <td className="px-2 py-1 text-right">TOTAL</td>
                      <td className="border border-slate-300 px-2 py-1 text-right">{pesos(informe.totalSaldo)}</td>
                      <td colSpan={5} />
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </Tarjeta>
        </>
      )}
    </Pantalla>
  );
}
