// Carga datos de demostración por la API y saca capturas en tamaño de celular.
//   node e2e/demo.mjs <url-base> <carpeta-de-salida>
import { chromium } from '@playwright/test';

const [base = 'http://127.0.0.1:5174', salida = '.'] = process.argv.slice(2);

async function api(metodo, ruta, cuerpo) {
  const r = await fetch(`${base}/api${ruta}`, {
    method: metodo,
    headers: { 'Content-Type': 'application/json' },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const datos = await r.json();
  if (!r.ok) throw new Error(`${metodo} ${ruta} → ${r.status} ${JSON.stringify(datos)}`);
  return datos;
}

await api('POST', '/socios', { nombre: 'Carlos' });
const socios = await api('POST', '/socios', { nombre: 'Andrés' });
const [andres, carlos] = socios; // orden alfabético

async function prestamo(nombre, documento, capital, tasaBp, parteCarlosBp, aporteCarlos, fecha, plazo, pagos) {
  const cliente = await api('POST', '/clientes', { nombre, documento });
  const { prestamoId } = await api('POST', '/prestamos', {
    clienteId: cliente.id,
    capital,
    tasaMensualBp: tasaBp,
    fechaDesembolso: fecha,
    plazoMeses: plazo,
    socios: [
      { socioId: carlos.id, tasaBp: parteCarlosBp, aporteCapital: aporteCarlos },
      { socioId: andres.id, tasaBp: tasaBp - parteCarlosBp, aporteCapital: capital - aporteCarlos },
    ],
  });
  for (const [f, monto] of pagos) await api('POST', `/prestamos/${prestamoId}/pagos`, { fecha: f, monto, medio: 'Efectivo' });
  return prestamoId;
}

await prestamo('María Gómez', '1001', 1_000_000, 300, 100, 400_000, '2026-04-10', null, [
  ['2026-05-10', 30_000], ['2026-06-10', 30_000], ['2026-07-10', 30_000], ['2026-08-10', 30_000], ['2026-09-10', 30_000],
]);
const jorge = await prestamo('Jorge Ramírez', '1002', 2_500_000, 500, 200, 1_000_000, '2026-05-03', null, [
  ['2026-06-03', 125_000], ['2026-07-03', 125_000], ['2026-08-03', 625_000],
]);
await prestamo('Luisa Fernanda Ortiz', '1003', 800_000, 400, 400, 800_000, '2026-06-05', null, [
  ['2026-07-05', 32_000], ['2026-08-05', 32_000], ['2026-09-05', 32_000],
]);
const pedro = await prestamo('Pedro Castaño', '1004', 1_500_000, 300, 100, 500_000, '2026-03-20', 6, [['2026-04-20', 45_000]]);

const largo = await prestamo('Rosa Elena Vargas', '1005', 600_000, 400, 400, 600_000, '2023-06-12', null, [['2023-07-12', 24_000]]);

const navegador = await chromium.launch({ channel: 'msedge' });
const page = await navegador.newPage({ viewport: { width: 390, height: 844 }, locale: 'es-CO', acceptDownloads: true });
const captura = async (ruta, esperar, archivo) => {
  await page.goto(base + ruta);
  await page.getByText(esperar).first().waitFor();
  await page.waitForTimeout(400);
  // La barra inferior es fija: se oculta para que no tape la captura de página completa.
  await page.addStyleTag({ content: 'nav { display: none !important }' });
  await page.screenshot({ path: `${salida}/${archivo}.png`, fullPage: true });
};
await captura('/', 'Plata prestada hoy', 'inicio');
await captura(`/prestamos/${jorge}`, 'Debe de capital', 'detalle');
await page.goto(base + '/');
await page.getByText('Plata prestada hoy').waitFor();
await page.screenshot({ path: `${salida}/inicio-pantalla.png` });
// Estado de cuenta en PDF de dos préstamos.
for (const [id, archivo] of [[jorge, 'estado-jorge'], [pedro, 'estado-pedro'], [largo, 'estado-largo']]) {
  await page.goto(`${base}/prestamos/${id}`);
  const descarga = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Estado de cuenta en PDF' }).click();
  await page.getByRole('button', { name: 'Descargar' }).click();
  await (await descarga).saveAs(`${salida}/${archivo}.pdf`);
}
await navegador.close();
console.log('capturas listas');
