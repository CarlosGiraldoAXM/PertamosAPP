// Convierte la hoja "PAGOS <MES> <AÑO>.xlsx" en un archivo SQL que carga los
// préstamos como SALDOS DE APERTURA en D1.
//
//   node herramientas/importar-hoja.mjs <hoja.xlsx> <salida.sql> <hoy YYYY-MM-DD> "<socio del capital>" "<otro socio>"
//
// Por cada fila crea el cliente y un préstamo que:
//   - arranca con el SALDO de la hoja, desde su último día de pago (≤ hoy), de
//     modo que nace al día y el próximo corte cae en su día de siempre;
//   - guarda el PRESTAMO original y los ABONOS anteriores como referencia;
//   - reparte la tasa: la columna "%" es del socio del capital y la diferencia
//     con TASA INTERES, del otro socio. Todo el capital es del socio del capital.
//
// No escribe en ninguna base: solo genera el SQL y un resumen para revisar.
// La hoja y el SQL tienen datos reales: van en docs/, que está fuera de git.
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import ExcelJS from 'exceljs';

const [rutaHoja, rutaSql, hoy, socioCapital, socioResto] = process.argv.slice(2);
if (!rutaHoja || !rutaSql || !/^\d{4}-\d{2}-\d{2}$/.test(hoy ?? '') || !socioCapital || !socioResto) {
  console.error('Uso: node herramientas/importar-hoja.mjs <hoja.xlsx> <salida.sql> <hoy YYYY-MM-DD> "<socio del capital>" "<otro socio>"');
  process.exit(1);
}

/** Texto limpio o null. */
const texto = (v) => {
  const t = String(v ?? '').replace(/\s+/g, ' ').trim();
  return t === '' ? null : t;
};

/** Pesos enteros desde un número o un texto como "750.000". */
function pesos(v) {
  if (typeof v === 'number') return Math.round(v);
  const n = Number(String(v ?? '').replace(/[.\s$]/g, ''));
  return Number.isSafeInteger(n) ? n : NaN;
}

/** "4000000+750.000" o "500.000-600.000" → [4000000, 750000]. Un 0 o vacío → []. */
function abonos(v) {
  if (v === null || v === undefined || v === '') return [];
  if (typeof v === 'number') return v > 0 ? [Math.round(v)] : [];
  return String(v)
    .split(/[+\-]/)
    .map((parte) => pesos(parte))
    .filter((n) => n > 0);
}

/** 0.03, "0.03", "2.5%", "3.5%" o "2.5" → puntos básicos (300, 300, 250, 350, 250). */
function puntosBasicos(v) {
  const t = String(v ?? '').replace(',', '.').trim();
  const n = Number(t.replace('%', ''));
  if (!Number.isFinite(n) || n <= 0) return NaN;
  // Con "%" o un valor ≥ 1 es un porcentaje; si no, una fracción (0.03 = 3 %).
  const porcentaje = t.includes('%') || n >= 1 ? n : n * 100;
  return Math.round(porcentaje * 100);
}

/** Último día `dia` del mes que sea ≤ hoy (recortado al fin de mes). */
function ultimoCorte(dia) {
  let [a, m] = hoy.split('-').map(Number);
  const d = Number(hoy.slice(8));
  const finDeMes = (anio, mes) => new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  if (Math.min(dia, finDeMes(a, m)) > d) {
    m -= 1;
    if (m === 0) [a, m] = [a - 1, 12];
  }
  return `${a}-${String(m).padStart(2, '0')}-${String(Math.min(dia, finDeMes(a, m))).padStart(2, '0')}`;
}

const sql = (v) => (v === null ? 'null' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const formato = (n) => n.toLocaleString('es-CO');

const libro = new ExcelJS.Workbook();
await libro.xlsx.readFile(rutaHoja);
const hoja = libro.worksheets[0];
const valor = (ref) => {
  const v = hoja.getCell(ref).value;
  return v && typeof v === 'object' && 'result' in v ? v.result : v;
};

const filas = [];
const avisos = [];
for (let r = 2; r <= hoja.rowCount; r++) {
  const cliente = texto(valor(`B${r}`));
  if (!cliente || typeof valor(`A${r}`) !== 'number') continue; // total, observaciones, filas vacías
  const n = valor(`A${r}`);
  const fecha = valor(`H${r}`);
  const fila = {
    n,
    cliente,
    vehiculo: texto(valor(`C${r}`)),
    placa: texto(valor(`D${r}`)),
    prestamo: pesos(valor(`E${r}`)),
    abonos: abonos(valor(`F${r}`)),
    saldo: pesos(valor(`G${r}`)),
    dia: fecha instanceof Date ? fecha.getUTCDate() : NaN,
    tasaBp: puntosBasicos(valor(`I${r}`)),
    socioBp: puntosBasicos(valor(`L${r}`)),
  };
  // En la hoja, una fila repite el nombre del cliente en VEHICULO: no es un vehículo.
  if (fila.vehiculo && fila.vehiculo.toUpperCase() === cliente.toUpperCase()) fila.vehiculo = null;

  const problemas = [];
  if (!(fila.prestamo > 0)) problemas.push('PRESTAMO inválido');
  if (!(fila.saldo > 0)) problemas.push('SALDO inválido');
  if (!(fila.dia >= 1 && fila.dia <= 31)) problemas.push('FECHA DE PAGO sin día');
  if (!(fila.tasaBp > 0)) problemas.push('TASA INTERES inválida');
  if (!(fila.socioBp > 0) || fila.socioBp > fila.tasaBp) problemas.push('% del socio inválido o mayor que la tasa');
  if (problemas.length > 0) {
    console.error(`Fila ${r} (${cliente}): ${problemas.join('; ')}`);
    process.exit(1);
  }

  // Lo que no cuadra en la propia hoja se informa, pero manda el SALDO.
  const esperado = fila.prestamo - fila.abonos.reduce((s, a) => s + a, 0);
  if (esperado !== fila.saldo) avisos.push(`#${n} ${cliente}: PRESTAMO − abonos = ${formato(esperado)}, pero SALDO = ${formato(fila.saldo)}`);
  const interes = Math.round((fila.saldo * fila.tasaBp) / 10_000);
  const interesHoja = pesos(valor(`J${r}`));
  if (interesHoja !== interes) avisos.push(`#${n} ${cliente}: TOTAL INTERES en la hoja ${formato(interesHoja)}; sobre el saldo da ${formato(interes)}`);
  const parte = Math.round((fila.saldo * fila.socioBp) / 10_000);
  const parteHoja = pesos(valor(`K${r}`));
  if (parteHoja !== parte) avisos.push(`#${n} ${cliente}: parte del socio en la hoja ${formato(parteHoja)}; sobre el saldo da ${formato(parte)}`);

  filas.push(fila);
}

// ------------------------------------------------------------------ SQL
// Los socios se buscan por nombre: si ya existen en la base se usan tal cual, y
// solo se crea el que falte. Así la carga no duplica un socio creado a mano.
const crearSocioSiFalta = (nombre) =>
  `insert into socios (id, nombre) select ${sql(randomUUID())}, ${sql(nombre)} where not exists (select 1 from socios where nombre = ${sql(nombre)});`;
const idDeSocio = (nombre) => `(select id from socios where nombre = ${sql(nombre)} order by created_at limit 1)`;
const lineas = [
  `-- Carga de saldos de apertura desde la hoja, al ${hoy}. Generado por herramientas/importar-hoja.mjs.`,
  crearSocioSiFalta(socioCapital),
  crearSocioSiFalta(socioResto),
];
filas.forEach((f, i) => {
  const cliente = randomUUID();
  const prestamo = randomUUID();
  // Segundos consecutivos: los informes ordenan por fecha de registro y así respetan el orden de la hoja.
  const creado = `${hoy}T12:00:${String(i).padStart(2, '0')}.000Z`;
  lineas.push(
    `insert into clientes (id, nombre, created_at) values (${sql(cliente)}, ${sql(f.cliente)}, ${sql(creado)});`,
    `insert into prestamos (id, cliente_id, capital_inicial, tasa_mensual_bp, fecha_desembolso, vehiculo, placa, origen_capital, origen_abonos, notas, created_at) values (${[
      prestamo,
      cliente,
      f.saldo,
      f.tasaBp,
      ultimoCorte(f.dia),
      f.vehiculo,
      f.placa,
      f.prestamo,
      JSON.stringify(f.abonos),
      `Saldo de apertura cargado el ${hoy} desde la hoja de control.`,
      creado,
    ]
      .map(sql)
      .join(', ')});`,
    `insert into prestamo_socios (prestamo_id, socio_id, tasa_bp, aporte_capital) values (${sql(prestamo)}, ${idDeSocio(socioCapital)}, ${f.socioBp}, ${f.saldo});`,
  );
  if (f.tasaBp > f.socioBp) {
    lineas.push(`insert into prestamo_socios (prestamo_id, socio_id, tasa_bp, aporte_capital) values (${sql(prestamo)}, ${idDeSocio(socioResto)}, ${f.tasaBp - f.socioBp}, 0);`);
  }
  // La fila de cierre hace que la base verifique que tasas y aportes cuadran con el préstamo.
  lineas.push(`insert into prestamos_verificados (prestamo_id) values (${sql(prestamo)});`);
});
writeFileSync(rutaSql, lineas.join('\n') + '\n');

// ------------------------------------------------------------------ resumen
const suma = (campo) => filas.reduce((s, f) => s + campo(f), 0);
console.log(`Préstamos: ${filas.length}`);
console.log(`Total SALDO: ${formato(suma((f) => f.saldo))}`);
console.log(`Interés mensual: ${formato(suma((f) => Math.round((f.saldo * f.tasaBp) / 10_000)))}`);
console.log(`  de ${socioCapital}: ${formato(suma((f) => Math.round((f.saldo * f.socioBp) / 10_000)))}`);
console.log(`  de ${socioResto}: ${formato(suma((f) => Math.round((f.saldo * (f.tasaBp - f.socioBp)) / 10_000)))}`);
console.log(`Días de pago: ${[...new Set(filas.map((f) => f.dia))].sort((a, b) => a - b).join(', ')}`);
console.log(avisos.length === 0 ? 'Sin diferencias en la hoja.' : `\nDiferencias dentro de la propia hoja (${avisos.length}):\n  ${avisos.join('\n  ')}`);
console.log(`\nSQL escrito en ${rutaSql} (${lineas.length} sentencias).`);
