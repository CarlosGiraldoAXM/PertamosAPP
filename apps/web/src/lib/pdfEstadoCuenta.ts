// Dibuja el estado de cuenta en un PDF tamaño carta. No calcula nada: recibe
// los datos ya armados por `armarEstadoDeCuenta`.
import type { EstadoDeCuenta } from '../datos/estadoCuenta.ts';
import { fechaCorta, pesos, porcentaje } from './formato.ts';
import { cargarLogo } from './logo.ts';

type Alineacion = 'left' | 'right';
interface Columna {
  titulo: string;
  ancho: number;
  alinear: Alineacion;
}

const MARGEN = 18;
const ALTO_FILA = 6.5;
const TINTA: [number, number, number] = [15, 23, 42];
const GRIS: [number, number, number] = [100, 116, 139];
const FONDO: [number, number, number] = [241, 245, 249];
const ROJO: [number, number, number] = [185, 28, 28];

const ESTADO_MES = { pagado: 'Pagado', adelantado: 'Adelantado', vencido: 'Pendiente', curso: 'En curso' } as const;

export async function generarPdfEstadoDeCuenta(ec: EstadoDeCuenta): Promise<Blob> {
  // Se carga solo al pedir el PDF, para no pesar en el arranque de la app.
  const [{ jsPDF }, logo] = await Promise.all([import('jspdf'), cargarLogo()]);
  const doc = new jsPDF({ unit: 'mm', format: 'letter' });
  const ancho = doc.internal.pageSize.getWidth();
  const alto = doc.internal.pageSize.getHeight();
  const derecha = ancho - MARGEN;
  const util = ancho - 2 * MARGEN;
  let y = MARGEN;

  const texto = (
    t: string,
    x: number,
    yy: number,
    o: { tam?: number; negrita?: boolean; color?: [number, number, number]; alinear?: Alineacion } = {},
  ) => {
    doc.setFont('helvetica', o.negrita ? 'bold' : 'normal');
    doc.setFontSize(o.tam ?? 10);
    doc.setTextColor(...(o.color ?? TINTA));
    doc.text(t, x, yy, { align: o.alinear ?? 'left' });
  };
  const asegurarEspacio = (necesario: number) => {
    if (y + necesario > alto - 20) {
      doc.addPage();
      y = MARGEN;
      return true;
    }
    return false;
  };

  // ------------------------------------------------------------ encabezado
  // Logo a la izquierda; título y fecha a la derecha.
  const ANCHO_LOGO = 44;
  const altoLogo = logo ? (ANCHO_LOGO * logo.alto) / logo.ancho : 0;
  // 'SLOW' = máxima compresión: sin ella el PDF pasa de 15 KB a más de 500 KB.
  if (logo) doc.addImage(logo.bytes, 'PNG', MARGEN, y - 2, ANCHO_LOGO, altoLogo, 'logo', 'SLOW');
  texto('Estado de cuenta', derecha, y + 6, { tam: 18, negrita: true, alinear: 'right' });
  texto(`Fecha: ${fechaCorta(ec.fecha)}`, derecha, y + 12, { color: GRIS, alinear: 'right' });
  y += Math.max(altoLogo + 4, 20);
  texto(ec.cliente.nombre, MARGEN, y, { tam: 12, negrita: true });
  if (ec.cliente.documento) texto(`C.C. ${ec.cliente.documento}`, derecha, y, { color: GRIS, alinear: 'right' });
  y += 6;
  const plazo = ec.prestamo.plazoMeses ? `plazo de ${ec.prestamo.plazoMeses} meses` : 'sin plazo fijo';
  texto(
    ec.prestamo.capitalOriginal === null
      ? `Préstamo de ${pesos(ec.prestamo.capital)} al ${porcentaje(ec.prestamo.tasaMensualBp)} mensual, entregado el ${fechaCorta(ec.prestamo.fechaDesembolso)}, ${plazo}.`
      : // Saldo de apertura: la fecha es la del saldo, no la de entrega del préstamo.
        `Préstamo original de ${pesos(ec.prestamo.capitalOriginal)} al ${porcentaje(ec.prestamo.tasaMensualBp)} mensual. Saldo de ${pesos(ec.prestamo.capital)} al ${fechaCorta(ec.prestamo.fechaDesembolso)}.`,
    MARGEN,
    y,
    { color: GRIS },
  );
  y += 6;

  // ------------------------------------------------------------ resumen
  const altoCaja = 30;
  doc.setFillColor(...FONDO);
  doc.roundedRect(MARGEN, y, util, altoCaja, 2, 2, 'F');
  texto(ec.prestamo.cancelado ? 'Préstamo cancelado' : 'Capital que debe hoy', MARGEN + 6, y + 9, { color: GRIS });
  texto(pesos(ec.capitalPendiente), MARGEN + 6, y + 21, { tam: 24, negrita: true });
  const xEtiqueta = MARGEN + util * 0.55;
  [
    ['Capital abonado', pesos(ec.capitalAbonado)],
    ['Interés pagado', pesos(ec.interesPagado)],
    ['Total pagado', pesos(ec.totalPagado)],
  ].forEach(([etiqueta, valor], i) => {
    texto(etiqueta!, xEtiqueta, y + 9 + i * 7, { color: GRIS });
    texto(valor!, derecha - 6, y + 9 + i * 7, { negrita: i === 2, alinear: 'right' });
  });
  y += altoCaja + 8;

  const renglon = (etiqueta: string, valor: string, o: { color?: [number, number, number]; negrita?: boolean } = {}) => {
    texto(etiqueta, MARGEN, y, { color: o.color ?? TINTA, negrita: o.negrita ?? false });
    texto(valor, derecha, y, { color: o.color ?? TINTA, negrita: true, alinear: 'right' });
    y += 6;
  };
  if (ec.interesVencido > 0) {
    const meses = `${ec.mesesAtrasados} ${ec.mesesAtrasados === 1 ? 'mes' : 'meses'}`;
    renglon(`Interés atrasado (${meses} sin pagar)`, pesos(ec.interesVencido), { color: ROJO });
  }
  if (ec.interesPagadoHasta) renglon('Interés pagado por adelantado hasta', fechaCorta(ec.interesPagadoHasta));
  if (ec.proximoPago) {
    const que = ec.proximoPago.incluyeCapital ? ' (interés del mes + todo el capital, por plazo cumplido)' : '';
    renglon(`Próximo pago: ${fechaCorta(ec.proximoPago.fecha)}${que}`, pesos(ec.proximoPago.monto));
  }
  if (ec.paraCancelarHoy) {
    renglon('Para cancelar todo hoy', pesos(ec.paraCancelarHoy.total), { negrita: true });
    texto(
      `Capital ${pesos(ec.paraCancelarHoy.capital)} + interés a la fecha ${pesos(ec.paraCancelarHoy.interes)}`,
      MARGEN,
      y - 1.5,
      { tam: 8, color: GRIS },
    );
    y += 4;
  }
  y += 4;

  // ------------------------------------------------------------ tablas
  const tabla = (titulo: string, columnas: Columna[], filas: string[][], pie?: string[]) => {
    const encabezado = () => {
      doc.setFillColor(...FONDO);
      doc.rect(MARGEN, y, util, ALTO_FILA, 'F');
      let x = MARGEN;
      for (const c of columnas) {
        texto(c.titulo, c.alinear === 'right' ? x + c.ancho - 2 : x + 2, y + 4.4, { tam: 8, negrita: true, color: GRIS, alinear: c.alinear });
        x += c.ancho;
      }
      y += ALTO_FILA;
    };
    const fila = (celdas: string[], negrita = false) => {
      let x = MARGEN;
      columnas.forEach((c, i) => {
        texto(celdas[i] ?? '', c.alinear === 'right' ? x + c.ancho - 2 : x + 2, y + 4.4, { tam: 9, negrita, alinear: c.alinear });
        x += c.ancho;
      });
      doc.setDrawColor(226, 232, 240);
      doc.setLineWidth(0.2);
      doc.line(MARGEN, y + ALTO_FILA, derecha, y + ALTO_FILA);
      y += ALTO_FILA;
    };

    asegurarEspacio(8 + ALTO_FILA * 3);
    texto(titulo, MARGEN, y, { tam: 11, negrita: true });
    y += 4;
    encabezado();
    for (const celdas of filas) {
      if (asegurarEspacio(ALTO_FILA)) encabezado();
      fila(celdas);
    }
    if (pie) {
      if (asegurarEspacio(ALTO_FILA)) encabezado();
      fila(pie, true);
    }
    y += 8;
  };

  if (ec.pagos.length === 0) {
    texto('Pagos realizados', MARGEN, y, { tam: 11, negrita: true });
    y += 6;
    texto('Todavía no hay pagos registrados.', MARGEN, y, { color: GRIS });
    y += 10;
  } else {
    tabla(
      `Pagos realizados (${ec.pagos.length})`,
      [
        { titulo: 'Fecha', ancho: util * 0.2, alinear: 'left' },
        { titulo: 'Valor pagado', ancho: util * 0.2, alinear: 'right' },
        { titulo: 'A interés', ancho: util * 0.2, alinear: 'right' },
        { titulo: 'A capital', ancho: util * 0.2, alinear: 'right' },
        { titulo: 'Capital que quedó', ancho: util * 0.2, alinear: 'right' },
      ],
      ec.pagos.map((p) => [fechaCorta(p.fecha), pesos(p.monto), pesos(p.aInteres), pesos(p.aCapital), pesos(p.saldoDespues)]),
      ['Total', pesos(ec.totalPagado), pesos(ec.interesPagado), pesos(ec.capitalAbonado), pesos(ec.capitalPendiente)],
    );
  }

  if (ec.meses.length > 0) {
    tabla(
      'Mes a mes',
      [
        { titulo: 'Mes', ancho: util * 0.1, alinear: 'left' },
        { titulo: 'Fecha de corte', ancho: util * 0.22, alinear: 'left' },
        { titulo: 'Sobre un capital de', ancho: util * 0.22, alinear: 'right' },
        { titulo: 'Interés del mes', ancho: util * 0.18, alinear: 'right' },
        { titulo: 'Pagado', ancho: util * 0.14, alinear: 'right' },
        { titulo: 'Estado', ancho: util * 0.14, alinear: 'right' },
      ],
      ec.meses.map((m) => [String(m.numero), fechaCorta(m.fechaCorte), pesos(m.saldoBase), pesos(m.interes), pesos(m.pagado), ESTADO_MES[m.estado]]),
    );
  }

  asegurarEspacio(12);
  texto('Cada pago cubre primero los intereses pendientes; lo que sobra se abona al capital.', MARGEN, y, { tam: 8, color: GRIS });
  y += 4;
  texto('El interés de cada mes se calcula sobre el capital que se debía al inicio de ese mes.', MARGEN, y, { tam: 8, color: GRIS });

  // ------------------------------------------------------------ pie de página
  const paginas = doc.getNumberOfPages();
  for (let i = 1; i <= paginas; i++) {
    doc.setPage(i);
    texto(`Documento informativo con los pagos registrados hasta el ${fechaCorta(ec.fecha)}.`, MARGEN, alto - 10, { tam: 8, color: GRIS });
    texto(`Página ${i} de ${paginas}`, derecha, alto - 10, { tam: 8, color: GRIS, alinear: 'right' });
  }

  return doc.output('blob');
}

export function nombreDelArchivo(ec: EstadoDeCuenta): string {
  const limpio = ec.cliente.nombre.replace(/[\\/:*?"<>|]/g, '').trim();
  return `Estado de cuenta - ${limpio} - ${ec.fecha}.pdf`;
}

