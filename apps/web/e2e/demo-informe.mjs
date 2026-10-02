// Carga unos préstamos parecidos a los de la hoja real y descarga el informe.
//   node e2e/demo-informe.mjs <url-base> <carpeta-de-salida>
import { chromium } from '@playwright/test';

const [base = 'http://127.0.0.1:5174', salida = '.'] = process.argv.slice(2);

async function api(metodo, ruta, cuerpo) {
  const r = await fetch(`${base}/api${ruta}`, { method: metodo, headers: { 'Content-Type': 'application/json' }, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
  const datos = await r.json();
  if (!r.ok) throw new Error(`${metodo} ${ruta} → ${r.status} ${JSON.stringify(datos)}`);
  return datos;
}

await api('POST', '/socios', { nombre: 'Carlos' });
const socios = await api('POST', '/socios', { nombre: 'Mateo' });
const carlos = socios.find((s) => s.nombre === 'Carlos');
const mateo = socios.find((s) => s.nombre === 'Mateo');

/** Mateo pone el capital y se lleva `mateoBp`; Carlos se queda con la diferencia de la tasa. */
async function prestamo(nombre, vehiculo, placa, capital, tasaBp, mateoBp, fecha, pagos = []) {
  const cliente = await api('POST', '/clientes', { nombre });
  const { prestamoId } = await api('POST', '/prestamos', {
    clienteId: cliente.id,
    capital,
    tasaMensualBp: tasaBp,
    fechaDesembolso: fecha,
    plazoMeses: null,
    vehiculo,
    placa,
    socios: [
      { socioId: mateo.id, tasaBp: mateoBp, aporteCapital: capital },
      ...(tasaBp > mateoBp ? [{ socioId: carlos.id, tasaBp: tasaBp - mateoBp, aporteCapital: 0 }] : []),
    ],
  });
  for (const [f, monto] of pagos) await api('POST', `/prestamos/${prestamoId}/pagos`, { fecha: f, monto });
}

await prestamo('CLIENTE UNO DE PRUEBA', 'CX 3', 'AAA 111', 40_000_000, 300, 250, '2026-09-05');
await prestamo('CLIENTE DOS DE PRUEBA', 'DUSTER DYNAMIQUE', 'BBB 222', 21_000_000, 400, 300, '2026-08-27', [['2026-09-27', 840_000]]);
await prestamo('CLIENTE TRES DE PRUEBA', 'MAZDA 2 GT', 'CCC 333', 34_000_000, 200, 200, '2026-07-15', [
  ['2026-08-15', 680_000 + 4_000_000],
  ['2026-09-15', 600_000 + 750_000],
]);
await prestamo('CLIENTE CUATRO DE PRUEBA', 'SPARK BLANCO', 'DDD 444', 7_000_000, 300, 250, '2026-08-05', [['2026-09-05', 210_000 + 3_000_000]]);
await prestamo('CLIENTE CINCO DE PRUEBA', 'YAMAHA N MAX', 'EEE 55F', 11_000_000, 350, 300, '2026-09-19');

const navegador = await chromium.launch({ channel: 'msedge' });
const page = await navegador.newPage({ viewport: { width: 390, height: 844 }, locale: 'es-CO', acceptDownloads: true });
await page.goto(`${base}/informe`);
await page.getByLabel('Socio del informe').selectOption({ label: 'Mateo' });
await page.getByLabel('Observaciones').fill('Sale un credito de prueba. Para el otro mes entra uno nuevo.');
await page.getByText('Así va a quedar la hoja').waitFor();
await page.screenshot({ path: `${salida}/informe.png`, fullPage: true });
await page.getByRole('button', { name: 'Generar Excel' }).click();
const descarga = page.waitForEvent('download');
await page.getByRole('button', { name: 'Descargar' }).click();
const archivo = await descarga;
await archivo.saveAs(`${salida}/${archivo.suggestedFilename()}`);
console.log('descargado:', archivo.suggestedFilename());
await navegador.close();
