// Dibuja el informe del socio en un .xlsx con la misma estructura de la hoja
// que se llevaba a mano: mismas columnas (A–L), anchos, bordes, negritas,
// formatos de número, fila TOTAL y recuadro de observaciones.
// No calcula nada: recibe los datos ya armados por `armarInformeSocio`.
import type { Borders, Worksheet } from 'exceljs';
import type { InformeSocio } from '../datos/informeSocio.ts';

const MILES = '#,##0';
const FECHA = 'd-mmm';
const ANCHOS = [4.86, 28.43, 16.29, 10.71, 17.29, 39.43, 16.14, 12.14, 7.14, 15.43, 14.86, 6.57]; // A..L
const FILAS_OBSERVACIONES = 6;

const fino = { style: 'thin' } as const;
const BORDE: Partial<Borders> = { top: fino, left: fino, bottom: fino, right: fino };

/** 300 → 0.03 con formato '0%'; 250 → 0.025 con '0.0#%'. */
function porcentaje(bp: number): { value: number; numFmt: string } {
  return { value: bp / 10_000, numFmt: bp % 100 === 0 ? '0%' : '0.0#%' };
}

function celda(hoja: Worksheet, ref: string, valor: unknown, o: { numFmt?: string; negrita?: boolean; alinear?: 'left' | 'center' | 'right'; borde?: boolean } = {}) {
  const c = hoja.getCell(ref);
  c.value = valor as never;
  c.font = { name: 'Calibri', size: 11, bold: o.negrita ?? false };
  if (o.numFmt) c.numFmt = o.numFmt;
  if (o.alinear) c.alignment = { horizontal: o.alinear };
  if (o.borde ?? true) c.border = BORDE;
}

export async function generarExcelInformeSocio(informe: InformeSocio): Promise<Blob> {
  // Se carga solo al pedir el informe, para no pesar en el arranque de la app.
  const { default: ExcelJS } = await import('exceljs');
  const libro = new ExcelJS.Workbook();
  const hoja = libro.addWorksheet('Hoja1', {
    // Para el papel: horizontal y ajustado al ancho de una hoja carta.
    pageSetup: { orientation: 'landscape', paperSize: 1 as never, fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 } },
  });
  ANCHOS.forEach((ancho, i) => (hoja.getColumn(i + 1).width = ancho));

  // Encabezado (fila 1). La columna A va sin título, como en la hoja original.
  const titulos = ['CLIENTE', 'VEHICULO', 'PLACA', 'PRESTAMO', 'ABONO A CAP', 'SALDO', 'FECHA DE PAGO', 'TASA INTERES', 'TOTAL INTERES', informe.socio.toUpperCase(), '%'];
  titulos.forEach((t, i) => celda(hoja, `${String.fromCharCode(66 + i)}1`, t, { negrita: true, alinear: i === titulos.length - 1 ? 'center' : undefined }));

  informe.filas.forEach((f, i) => {
    const r = i + 2;
    celda(hoja, `A${r}`, f.numero, { negrita: true, alinear: 'center', borde: false });
    celda(hoja, `B${r}`, f.cliente);
    celda(hoja, `C${r}`, f.vehiculo ?? '');
    celda(hoja, `D${r}`, f.placa ?? '');
    celda(hoja, `E${r}`, f.prestamo, { numFmt: MILES });
    // Sin abonos: 0. Uno: el número. Varios: el detalle de cada uno, como se anotaba a mano.
    if (f.abonos.length <= 1) celda(hoja, `F${r}`, f.abonos[0] ?? 0, { numFmt: MILES, alinear: 'right' });
    else celda(hoja, `F${r}`, f.abonos.map((a) => a.toLocaleString('es-CO')).join(' - '), { alinear: 'right' });
    celda(hoja, `G${r}`, f.saldo, { numFmt: MILES });
    if (f.fechaPago) {
      const [a, m, d] = f.fechaPago.split('-').map(Number);
      celda(hoja, `H${r}`, new Date(Date.UTC(a!, m! - 1, d!)), { numFmt: FECHA, alinear: 'right' });
    } else celda(hoja, `H${r}`, '', { alinear: 'right' });
    const tasa = porcentaje(f.tasaBp);
    celda(hoja, `I${r}`, tasa.value, { numFmt: tasa.numFmt, alinear: 'right' });
    celda(hoja, `J${r}`, f.totalInteres, { numFmt: MILES });
    celda(hoja, `K${r}`, f.interesSocio, { numFmt: MILES });
    const parte = porcentaje(f.socioBp);
    celda(hoja, `L${r}`, parte.value, { numFmt: parte.numFmt, alinear: 'right' });
  });

  // Fila TOTAL, justo debajo de la última.
  const ultima = informe.filas.length + 1;
  const total = ultima + 1;
  celda(hoja, `F${total}`, 'TOTAL', { negrita: true, alinear: 'right', borde: false });
  const suma = informe.filas.length > 0 ? { formula: `SUM(G2:G${ultima})`, result: informe.totalSaldo } : 0;
  celda(hoja, `G${total}`, suma, { numFmt: MILES, negrita: true });

  // Observaciones: recuadro combinado B..K, dejando una fila en blanco.
  const inicio = total + 2;
  hoja.mergeCells(`B${inicio}:K${inicio + FILAS_OBSERVACIONES - 1}`);
  const obs = hoja.getCell(`B${inicio}`);
  obs.value = `OBSERVACIONES: ${informe.observaciones}`;
  obs.font = { name: 'Calibri', size: 11 };
  obs.alignment = { wrapText: true, vertical: 'top', horizontal: 'left' };
  obs.border = BORDE;

  const datos = await libro.xlsx.writeBuffer();
  return new Blob([datos], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

/** 'PAGOS OCTUBRE 2026.xlsx', como se nombraba el archivo. */
export function nombreDelInforme(informe: InformeSocio): string {
  return `${informe.titulo}.xlsx`;
}
