import { defineConfig } from '@playwright/test';

// Pruebas de la app en un navegador real (Edge instalado en Windows), con
// tamaño de celular, contra Supabase local (`npm run db:start`).
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    channel: 'msedge',
    viewport: { width: 390, height: 844 },
    locale: 'es-CO',
    timezoneId: 'America/Bogota',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    cwd: '../..',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
