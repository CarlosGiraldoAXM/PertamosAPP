import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Las pruebas de propiedades generan miles de casos; con la máquina cargada
    // (Docker con Supabase local) pasan fácil los 5 s por defecto.
    testTimeout: 60_000,
  },
});
