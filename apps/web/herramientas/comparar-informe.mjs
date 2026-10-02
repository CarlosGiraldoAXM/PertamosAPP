// Compara el informe que genera la app contra la hoja original, fila por fila.
//   node herramientas/comparar-informe.mjs <hoja-original.xlsx> <informe-generado.xlsx>
// La hoja original tiene la tabla desde la fila 1; el informe, desde la fila 6 (arriba va el logo).
import ExcelJS from 'exceljs';

const [rutaOriginal, rutaGenerado] = process.argv.slice(2);
const abrir = async (ruta) => {
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.readFile(ruta);
  return libro.worksheets[0];
};
const original = await abrir(rutaOriginal);
const generado = await abrir(rutaGenerado);

const crudo = (hoja, ref) => {
  const v = hoja.getCell(ref).value;
  return v && typeof v === 'object' && 'result' in v ? v.result : v;
};
const texto = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const numero = (v) => (typeof v === 'number' ? Math.round(v) : Number(String(v ?? '').replace(/[.\s$]/g, '')));
/** Porcentaje como puntos básicos, venga como 0.03, "2.5%" o "2.5". */
const bp = (v) => {
  const t = String(v ?? '').replace(',', '.').trim();
  const n = Number(t.replace('%', ''));
  return Math.round((t.includes('%') || n >= 1 ? n : n * 100) * 100);
};
const abonos = (v) =>
  typeof v === 'number'
    ? v > 0 ? [Math.round(v)] : []
    : String(v ?? '').split(/[+\-]/).map((p) => Number(p.replace(/[.\s]/g, ''))).filter((n) => n > 0);

const columnas = [
  ['CLIENTE', 'B', texto],
  ['VEHICULO', 'C', texto],
  ['PLACA', 'D', texto],
  ['PRESTAMO', 'E', numero],
  ['ABONO A CAP', 'F', (v) => abonos(v).join('+')],
  ['SALDO', 'G', numero],
  ['TASA INTERES', 'I', bp],
  ['TOTAL INTERES', 'J', numero],
  ['SOCIO', 'K', numero],
  ['%', 'L', bp],
];

let filas = 0;
let iguales = 0;
const diferencias = [];
for (let r = 2; typeof crudo(original, `A${r}`) === 'number'; r++) {
  filas++;
  const g = r + 5; // la tabla del informe empieza cinco filas más abajo
  let filaIgual = true;
  for (const [nombre, col, normalizar] of columnas) {
    const a = normalizar(crudo(original, `${col}${r}`));
    const b = normalizar(crudo(generado, `${col}${g}`));
    if (a !== b) {
      filaIgual = false;
      diferencias.push(`#${crudo(original, `A${r}`)} ${nombre}: hoja «${a}» / app «${b}»`);
    }
  }
  // De la fecha de pago solo se compara el día del mes.
  const dia = (v) => (v instanceof Date ? v.getUTCDate() : NaN);
  if (dia(crudo(original, `H${r}`)) !== dia(crudo(generado, `H${g}`))) {
    filaIgual = false;
    diferencias.push(`#${crudo(original, `A${r}`)} DÍA DE PAGO: hoja ${dia(crudo(original, `H${r}`))} / app ${dia(crudo(generado, `H${g}`))}`);
  }
  if (filaIgual) iguales++;
}
const totalOriginal = numero(crudo(original, `G${filas + 2}`));
const totalGenerado = numero(crudo(generado, `G${filas + 7}`));
console.log(`Filas: ${filas} | idénticas: ${iguales} | con diferencias: ${filas - iguales}`);
console.log(`TOTAL saldos: hoja ${totalOriginal.toLocaleString('es-CO')} / app ${totalGenerado.toLocaleString('es-CO')} ${totalOriginal === totalGenerado ? '(igual)' : '(DISTINTO)'}`);
if (diferencias.length > 0) console.log('\n' + diferencias.join('\n'));
