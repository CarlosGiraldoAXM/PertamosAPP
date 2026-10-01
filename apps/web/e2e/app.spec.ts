import { expect, test, type Page } from '@playwright/test';

/** Falla la prueba ante cualquier error de JavaScript, de consola o respuesta HTTP fallida. */
function registrarErrores(page: Page): string[] {
  const errores: string[] = [];
  page.on('pageerror', (e) => errores.push(e.message));
  page.on('console', (m) => {
    // Los recursos fallidos se registran abajo con su URL.
    if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errores.push(m.text());
  });
  page.on('response', (r) => {
    if (r.status() >= 400) errores.push(`${r.status()} ${r.request().method()} ${r.url()}`);
  });
  return errores;
}

test('socios → cliente → préstamo con dos socios → pago → reverso → cancelación total', async ({ page }) => {
  const errores = registrarErrores(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Inicio' })).toBeVisible();

  // Con la base vacía, el Inicio guía los primeros pasos y lleva al primero pendiente.
  await expect(page.getByText('Para empezar')).toBeVisible();
  await page.getByRole('button', { name: 'Ir' }).click();

  // Socios
  await expect(page.getByRole('heading', { name: 'Cuenta' })).toBeVisible();
  await expect(page.getByText('Todavía no hay socios.')).toBeVisible();
  for (const nombre of ['Socio A', 'Socio B']) {
    await page.getByLabel('Nuevo socio').fill(nombre);
    await page.getByRole('button', { name: 'Agregar' }).click();
    await expect(page.getByText(nombre, { exact: true })).toBeVisible();
  }

  // Cliente
  await page.getByRole('link', { name: /Clientes/ }).click();
  await page.getByRole('button', { name: '+ Nuevo' }).click();
  await page.getByLabel('Nombre').fill('María Gómez');
  await page.getByLabel('Cédula').fill('1000000001');
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByRole('heading', { name: 'María Gómez' })).toBeVisible();

  // Préstamo: $1.000.000 al 3 % (Socio A 1 % / $400.000, Socio B 2 % / $600.000)
  await page.getByRole('button', { name: 'Nuevo préstamo' }).click();
  await expect(page.getByRole('heading', { name: 'Nuevo préstamo' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Capital', exact: true }).fill('1000000');
  await expect(page.getByRole('textbox', { name: 'Capital', exact: true })).toHaveValue('1.000.000');
  await page.getByLabel('Tasa mensual (%)').fill('3');
  await page.getByLabel('Fecha de desembolso').fill('2026-01-15');

  // Con las partes de los socios a medio llenar, avisa y no deja crear.
  await page.getByLabel('Su tasa (%)').nth(0).fill('1');
  await page.getByRole('textbox', { name: 'Capital que pone' }).nth(0).fill('400000');
  await expect(page.getByText('1 % de 3 %')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Crear préstamo' })).toBeDisabled();

  await page.getByLabel('Su tasa (%)').nth(1).fill('2');
  await page.getByRole('textbox', { name: 'Capital que pone' }).nth(1).fill('600000');
  await expect(page.getByText('3 % de 3 %')).toBeVisible();
  await expect(page.getByText('1. 15 feb 2026')).toBeVisible();
  await page.getByRole('button', { name: 'Crear préstamo' }).click();

  // Detalle
  await expect(page.getByRole('heading', { name: 'María Gómez' })).toBeVisible();
  await expect(page.getByText('Debe de capital')).toBeVisible();

  // Pago: se ve la imputación antes de confirmar
  await page.getByRole('button', { name: 'Registrar pago' }).click();
  await expect(page.getByRole('heading', { name: 'Registrar pago' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Monto recibido' }).fill('260000');
  await page.getByLabel('Fecha del pago').fill('2026-03-15');
  await expect(page.getByText('Interés del mes 1')).toBeVisible();
  await expect(page.getByText('Interés del mes 2')).toBeVisible();
  await expect(page.getByText('Abono a capital')).toBeVisible();
  await expect(page.getByText('$ 800.000')).toBeVisible(); // queda debiendo
  await page.getByRole('button', { name: /Confirmar pago de \$ 260\.000/ }).click();

  await expect(page.getByRole('heading', { name: 'María Gómez' })).toBeVisible();
  await expect(page.getByText(/Pago · 15 mar 2026/)).toBeVisible();
  await expect(page.getByText('$ 800.000').first()).toBeVisible();

  // Reverso del último pago: vuelve a deber todo
  await page.getByRole('button', { name: 'Reversar este pago' }).click();
  await page.getByLabel('Motivo').fill('Prueba');
  await page.getByRole('button', { name: 'Confirmar reverso' }).click();
  await expect(page.getByText('Reversado')).toBeVisible();
  await expect(page.getByText('$ 1.000.000').first()).toBeVisible();

  // Aparece como atrasado en Inicio (ya con gráficas) y en Préstamos
  await page.getByRole('link', { name: /Inicio/ }).click();
  await expect(page.getByText('Plata prestada hoy')).toBeVisible();
  await expect(page.getByRole('link', { name: /María Gómez/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /oct 2026: \$ 0/ })).toBeVisible();
  await page.getByRole('link', { name: /Préstamos/ }).click();
  await page.getByRole('link', { name: /María Gómez/ }).click();

  // Estado de cuenta en PDF para el cliente: se genera y queda listo para compartir o descargar
  await page.getByRole('button', { name: 'Estado de cuenta en PDF' }).click();
  await expect(page.getByText('El estado de cuenta está listo')).toBeVisible();
  const descarga = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Descargar' }).click();
  const pdf = await descarga;
  expect(pdf.suggestedFilename()).toMatch(/^Estado de cuenta - María Gómez - \d{4}-\d{2}-\d{2}\.pdf$/);
  const ruta = await pdf.path();
  expect((await import('node:fs')).readFileSync(ruta).subarray(0, 5).toString()).toBe('%PDF-');

  // Cancelación total
  await page.getByRole('button', { name: 'Cancelar todo' }).click();
  await expect(page.getByRole('heading', { name: 'Cancelar todo' })).toBeVisible();
  await expect(page.getByText('Total exacto')).toBeVisible();
  await page.getByRole('button', { name: 'Confirmar cancelación' }).click();
  await expect(page.getByText('Pagado', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Registrar pago' })).toHaveCount(0);

  expect(errores).toEqual([]);
});

test('una dirección interna abierta directamente carga la app (SPA)', async ({ page }) => {
  const errores = registrarErrores(page);
  await page.goto('/clientes');
  await expect(page.getByRole('heading', { name: 'Clientes' })).toBeVisible();
  expect(errores).toEqual([]);
});
