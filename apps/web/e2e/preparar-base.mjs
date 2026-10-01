// Deja una base D1 local vacía y migrada para las pruebas de navegador.
import { execSync } from 'node:child_process';
import { rmSync } from 'node:fs';

rmSync('.wrangler/e2e', { recursive: true, force: true });
execSync('npx wrangler d1 migrations apply prestamos --local --persist-to .wrangler/e2e', {
  stdio: 'inherit',
  env: { ...process.env, CI: '1' },
});
