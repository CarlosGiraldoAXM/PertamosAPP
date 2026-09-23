import { execFileSync, execSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';

function registrarErrores(page: Page): string[] {
  const errores: string[] = [];
  page.on('pageerror', (e) => errores.push(e.message));
  page.on('console', (m) => {
    // Los recursos fallidos se registran abajo con su URL.
    if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errores.push(m.text());
  });
  // Respuestas fallidas con su URL (el mensaje de consola del navegador no la incluye).
  page.on('response', (r) => {
    if (r.status() >= 400) errores.push(`${r.status()} ${r.request().method()} ${r.url()}`);
  });
  return errores;
}

async function entrar(page: Page, email: string, clave: string) {
  await page.goto('/');
  await page.getByLabel('Correo').fill(email);
  await page.getByLabel('Clave').fill(clave);
  await page.getByRole('button', { name: 'Entrar' }).click();
}

test('admin: cliente → préstamo con dos socios → pago → reverso', async ({ page }) => {
  const errores = registrarErrores(page);
  await entrar(page, 'admin@local.test', 'Admin12345');
  await expect(page.getByRole('heading', { name: 'Inicio' })).toBeVisible();

  // Cliente nuevo
  await page.getByRole('link', { name: /Clientes/ }).click();
  await page.getByRole('button', { name: '+ Nuevo' }).click();
  const nombre = `Cliente E2E ${Date.now()}`;
  await page.getByLabel('Nombre').fill(nombre);
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByRole('heading', { name: nombre })).toBeVisible();

  // Préstamo: $1.000.000 al 3 % (Socio A 1 % / $400.000, Socio B 2 % / $600.000)
  await page.getByRole('button', { name: 'Nuevo préstamo' }).click();
  await expect(page.getByRole('heading', { name: 'Nuevo préstamo' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Capital', exact: true }).fill('1000000');
  await expect(page.getByRole('textbox', { name: 'Capital', exact: true })).toHaveValue('1.000.000');
  await page.getByLabel('Tasa mensual (%)').fill('3');
  await page.getByLabel('Fecha de desembolso').fill('2026-01-15');
  await page.getByLabel('Su tasa (%)').nth(0).fill('1');
  await page.getByRole('textbox', { name: 'Capital que pone' }).nth(0).fill('400000');
  await page.getByLabel('Su tasa (%)').nth(1).fill('2');
  await page.getByRole('textbox', { name: 'Capital que pone' }).nth(1).fill('600000');
  await expect(page.getByText('3 % de 3 %')).toBeVisible();
  await expect(page.getByText('1. 15 feb 2026')).toBeVisible();
  await page.getByRole('button', { name: 'Crear préstamo' }).click();

  // Detalle
  await expect(page.getByRole('heading', { name: nombre })).toBeVisible();
  await expect(page.getByText('Debe de capital')).toBeVisible();
  await expect(page.getByText('$ 1.000.000').first()).toBeVisible();

  // Registrar pago: el monto sugerido es lo vencido; se ve la imputación antes de confirmar
  await page.getByRole('button', { name: 'Registrar pago' }).click();
  await expect(page.getByRole('heading', { name: 'Registrar pago' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Monto recibido' }).fill('60000');
  await page.getByLabel('Fecha del pago').fill('2026-03-15');
  await expect(page.getByText('Interés del mes 1')).toBeVisible();
  await expect(page.getByText('Interés del mes 2')).toBeVisible();
  await page.getByRole('button', { name: /Confirmar pago de \$ 60\.000/ }).click();

  await expect(page.getByRole('heading', { name: nombre })).toBeVisible();
  await expect(page.getByText(/Pago · 15 mar 2026/)).toBeVisible();

  // Reverso del último pago
  await page.getByRole('button', { name: 'Reversar este pago' }).click();
  await page.getByLabel('Motivo').fill('Prueba E2E');
  await page.getByRole('button', { name: 'Confirmar reverso' }).click();
  await expect(page.getByText('Reversado')).toBeVisible();

  // Inicio muestra el préstamo atrasado
  await page.getByRole('link', { name: /Inicio/ }).click();
  await expect(page.getByRole('link', { name: new RegExp(nombre) }).first()).toBeVisible();

  expect(errores).toEqual([]);
});

test('consulta: ve la cartera pero no tiene botones de escritura', async ({ page }) => {
  const errores = registrarErrores(page);
  await entrar(page, 'consulta@local.test', 'Consulta12345');
  await expect(page.getByRole('heading', { name: 'Inicio' })).toBeVisible();
  await page.getByRole('link', { name: /Clientes/ }).click();
  await expect(page.getByRole('heading', { name: 'Clientes' })).toBeVisible();
  await expect(page.getByRole('button', { name: '+ Nuevo' })).toHaveCount(0);
  await page.getByRole('link', { name: /Préstamos/ }).click();
  await expect(page.getByRole('button', { name: '+ Nuevo' })).toHaveCount(0);
  expect(errores).toEqual([]);
});

/** Secret key de la base LOCAL, leída de la CLI en el momento (nunca escrita en el repo). */
function secretKeyLocal(): string {
  const salida = execSync('npx supabase status -o json', { cwd: '../..', encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const clave = (JSON.parse(salida.slice(salida.indexOf('{'))) as { SECRET_KEY?: string }).SECRET_KEY;
  if (!clave) throw new Error('No se pudo leer SECRET_KEY de `supabase status`');
  return clave;
}

test('primer ingreso: obliga a cambiar la clave inicial', async ({ page }) => {
  const email = `nuevo.${Date.now()}@local.test`;
  execFileSync('node', ['../../scripts/crear-admin.mjs'], {
    env: {
      ...process.env,
      SUPABASE_URL: 'http://127.0.0.1:55621',
      SUPABASE_SECRET_KEY: secretKeyLocal(),
      ADMIN_EMAIL: email,
      ADMIN_NOMBRE: 'Nuevo',
      ADMIN_CLAVE_INICIAL: 'Inicial12345',
    },
  });
  const errores = registrarErrores(page);
  await entrar(page, email, 'Inicial12345');
  await expect(page.getByRole('heading', { name: 'Cambia tu clave' })).toBeVisible();

  await page.getByLabel('Clave nueva').fill('corta');
  await page.getByLabel('Repite la clave').fill('corta');
  await page.getByRole('button', { name: 'Guardar clave' }).click();
  await expect(page.getByText('Debe tener al menos 10 caracteres')).toBeVisible();

  await page.getByLabel('Clave nueva').fill('NuevaClave123');
  await page.getByLabel('Repite la clave').fill('NuevaClave123');
  await page.getByRole('button', { name: 'Guardar clave' }).click();
  await expect(page.getByRole('heading', { name: 'Inicio' })).toBeVisible();
  expect(errores).toEqual([]);
});
