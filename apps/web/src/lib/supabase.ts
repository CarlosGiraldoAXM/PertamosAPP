import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const clave = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

if (!url || !clave) {
  throw new Error('Faltan VITE_SUPABASE_URL o VITE_SUPABASE_PUBLISHABLE_KEY (ver apps/web/.env.example)');
}

/** Cliente con la clave pública: todo lo que lee pasa por RLS. */
export const supabase = createClient(url, clave, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

export const googleHabilitado = import.meta.env.VITE_GOOGLE_HABILITADO === 'true';
