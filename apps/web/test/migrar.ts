import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';

// Idempotente: solo aplica las migraciones que falten.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
