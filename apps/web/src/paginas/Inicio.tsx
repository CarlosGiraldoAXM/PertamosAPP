import { Link } from 'react-router';
import { cargarPrestamos, cargarSocios } from '../datos/cartera.ts';
import { resumirCartera, type PrestamoConEstado } from '../datos/reportes.ts';
import { useCarga } from '../datos/useCarga.ts';
import { fechaCorta, pesos } from '../lib/formato.ts';
import { hoyBogota } from '../lib/hoy.ts';
import { Aviso, Cargando, Cuota, Etiqueta, Fila, Pantalla, Tarjeta } from '../ui/componentes.tsx';

function FilaCobro({ p, atrasado }: { p: PrestamoConEstado; atrasado: boolean }) {
  const e = p.estado;
  const cobro = atrasado ? e.aCobrarHoy : e.proximoCorte!;
  return (
    <Link to={`/prestamos/${p.fila.id}`} className="flex items-center justify-between gap-3 py-3 hover:bg-slate-50">
      <div className="min-w-0">
        <p className="truncate font-medium text-slate-900">{p.fila.clientes?.nombre}</p>
        <p className="text-sm text-slate-500">
          {atrasado ? (
            <Etiqueta color="rojo">
              {e.diasAtraso} días · {e.periodosAtrasados} {e.periodosAtrasados === 1 ? 'mes' : 'meses'}
            </Etiqueta>
          ) : (
            `Corta el ${fechaCorta(e.proximoCorte!.fecha)}`
          )}
        </p>
      </div>
      <Cuota redondeada={cobro.cuotaACobrar} exacta={cobro.interesExacto} />
    </Link>
  );
}

export function Inicio() {
  const hoy = hoyBogota();
  const carga = useCarga(async () => {
    const [cartera, socios] = await Promise.all([cargarPrestamos(), cargarSocios()]);
    return resumirCartera(cartera, socios, hoy);
  }, [hoy]);

  return (
    <Pantalla titulo="Inicio" subtitulo={`Hoy, ${fechaCorta(hoy)}`}>
      {carga.cargando && !carga.datos && <Cargando />}
      {carga.error && <Aviso>{carga.error}</Aviso>}
      {carga.datos && (
        <>
          <Tarjeta titulo={`Atrasados (${carga.datos.atrasados.length})`}>
            {carga.datos.atrasados.length === 0 ? (
              <p className="text-sm text-slate-500">Nadie está atrasado. 🎉</p>
            ) : (
              <div className="-my-3 divide-y divide-slate-100">
                {carga.datos.atrasados.map((p) => (
                  <FilaCobro key={p.fila.id} p={p} atrasado />
                ))}
              </div>
            )}
          </Tarjeta>

          <Tarjeta titulo={`Cortan esta semana (${carga.datos.proximos.length})`}>
            {carga.datos.proximos.length === 0 ? (
              <p className="text-sm text-slate-500">Ningún corte en los próximos 7 días.</p>
            ) : (
              <div className="-my-3 divide-y divide-slate-100">
                {carga.datos.proximos.map((p) => (
                  <FilaCobro key={p.fila.id} p={p} atrasado={false} />
                ))}
              </div>
            )}
          </Tarjeta>

          <Tarjeta titulo="Cartera">
            <Fila etiqueta="Préstamos activos">{carga.datos.prestamosActivos}</Fila>
            <Fila etiqueta="Capital en la calle" fuerte>
              {pesos(carga.datos.capitalEnCalle)}
            </Fila>
            <Fila etiqueta="Interés esperado por mes">{pesos(carga.datos.interesMensualEsperado)}</Fila>
            <Fila etiqueta="Interés cobrado este mes" fuerte>
              {pesos(carga.datos.interesCobradoMes)}
            </Fila>
            <Fila etiqueta="Interés vencido por cobrar">
              <span className={carga.datos.interesVencido > 0 ? 'text-rose-700' : ''}>{pesos(carga.datos.interesVencido)}</span>
            </Fila>
            <div className="my-2 border-t border-slate-100" />
            <Fila etiqueta="Capital prestado (histórico)">{pesos(carga.datos.capitalPrestadoTotal)}</Fila>
            <Fila etiqueta="Capital recuperado">{pesos(carga.datos.capitalRecuperado)}</Fila>
            <Fila etiqueta="Interés cobrado (histórico)">{pesos(carga.datos.interesCobradoTotal)}</Fila>
          </Tarjeta>

          {carga.datos.socios.map((s) => (
            <Tarjeta key={s.socioId} titulo={s.nombre}>
              <Fila etiqueta="Capital suyo en la calle" fuerte>
                {pesos(s.capitalVivo)}
              </Fila>
              <Fila etiqueta="Interés esperado por mes">{pesos(s.interesMensualEsperado)}</Fila>
              <Fila etiqueta="Interés cobrado este mes">{pesos(s.interesCobradoMes)}</Fila>
              <Fila etiqueta="Interés cobrado (histórico)">{pesos(s.interesCobradoTotal)}</Fila>
            </Tarjeta>
          ))}
        </>
      )}
    </Pantalla>
  );
}
