import { cloudflare } from '@cloudflare/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// El plugin de Cloudflare corre el Worker (API + D1 local) dentro del mismo
// servidor de desarrollo, con el runtime real de Workers.
// `--mode e2e` (pruebas de navegador) usa una base aparte, para no tocar los
// datos de desarrollo.
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), cloudflare({ persistState: { path: mode === 'e2e' ? '.wrangler/e2e' : '.wrangler/state' } })],
  server: { port: mode === 'e2e' ? 5174 : 5173, host: '127.0.0.1', strictPort: true },
}));
