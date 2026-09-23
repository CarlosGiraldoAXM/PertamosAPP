#!/usr/bin/env node
// Crea el usuario administrador en un proyecto Supabase (una sola vez).
//
//   npm run crear-admin
//
// Pide por consola (sin mostrarlos) lo que no venga en variables de entorno:
//   SUPABASE_URL         por defecto https://<project-ref>.supabase.co del proyecto vinculado
//   SUPABASE_SECRET_KEY  secret key (sb_secret_…) o service_role del proyecto
//   ADMIN_EMAIL
//   ADMIN_NOMBRE         por defecto, la parte del correo antes de la @
//   ADMIN_CLAVE_INICIAL  el usuario debe cambiarla en el primer ingreso
//
// Crea el usuario en Auth con el correo confirmado y su fila en public.usuarios
// con rol admin. Si falla lo segundo, borra lo primero para no dejar un usuario
// huérfano. Sin dependencias: solo Node 18+.

import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

function preguntar(texto, { oculto = false } = {}) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (oculto) {
      rl._writeToOutput = (s) => {
        if (s.startsWith(texto)) rl.output.write(texto);
      };
    }
    rl.question(texto, (respuesta) => {
      rl.close();
      if (oculto) process.stdout.write('\n');
      resolve(respuesta.trim());
    });
  });
}

function urlPorDefecto() {
  try {
    const ref = readFileSync(new URL('../supabase/.temp/project-ref', import.meta.url), 'utf8').trim();
    return ref ? `https://${ref}.supabase.co` : '';
  } catch {
    return '';
  }
}

// Misma política que Auth (supabase/config.toml): ≥ 10 caracteres, mayúsculas, minúsculas y números.
function validarClave(clave) {
  if (clave.length < 10) return 'debe tener al menos 10 caracteres';
  if (!/[a-z]/.test(clave) || !/[A-Z]/.test(clave) || !/[0-9]/.test(clave)) {
    return 'debe tener mayúsculas, minúsculas y números';
  }
  return null;
}

async function main() {
  const porDefecto = urlPorDefecto();
  const url = (process.env.SUPABASE_URL || (await preguntar(`URL del proyecto [${porDefecto}]: `)) || porDefecto).replace(/\/+$/, '');
  const clave = process.env.SUPABASE_SECRET_KEY || (await preguntar('Secret key del proyecto: ', { oculto: true }));
  const email = (process.env.ADMIN_EMAIL || (await preguntar('Correo del admin: '))).toLowerCase();
  const nombre = process.env.ADMIN_NOMBRE || (await preguntar(`Nombre [${email.split('@')[0]}]: `)) || email.split('@')[0];
  let claveInicial = process.env.ADMIN_CLAVE_INICIAL;
  if (!claveInicial) {
    claveInicial = await preguntar('Clave inicial: ', { oculto: true });
    if ((await preguntar('Repite la clave: ', { oculto: true })) !== claveInicial) throw new Error('Las claves no coinciden');
  }

  if (!/^https?:\/\//.test(url)) throw new Error('Falta la URL del proyecto');
  if (!clave) throw new Error('Falta la secret key');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error(`Correo inválido: ${email}`);
  const problema = validarClave(claveInicial);
  if (problema) throw new Error(`La clave inicial ${problema}`);

  // Las secret keys nuevas (sb_secret_…) van solo en `apikey`; las service_role legacy (JWT) también como Bearer.
  const headers = { apikey: clave, 'Content-Type': 'application/json' };
  if (clave.startsWith('eyJ')) headers.Authorization = `Bearer ${clave}`;

  const pedir = async (metodo, ruta, cuerpo, extra = {}) => {
    const r = await fetch(`${url}${ruta}`, {
      method: metodo,
      headers: { ...headers, ...extra },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    });
    const texto = await r.text();
    const datos = texto ? JSON.parse(texto) : null;
    if (!r.ok) {
      const detalle = datos?.msg || datos?.message || datos?.error_description || texto;
      throw new Error(`${metodo} ${ruta} → ${r.status}: ${detalle}`);
    }
    return datos;
  };

  console.log(`\nCreando ${email} en ${url} …`);
  const usuario = await pedir('POST', '/auth/v1/admin/users', {
    email,
    password: claveInicial,
    email_confirm: true,
  });

  try {
    await pedir(
      'POST',
      '/rest/v1/usuarios',
      { id: usuario.id, email, nombre, rol: 'admin', debe_cambiar_clave: true },
      { Prefer: 'return=minimal' },
    );
  } catch (e) {
    await pedir('DELETE', `/auth/v1/admin/users/${usuario.id}`).catch(() => {});
    throw new Error(`No se pudo registrar en public.usuarios; se deshizo el usuario de Auth. ${e.message}`);
  }

  console.log(`Listo: ${email} es admin (id ${usuario.id}). Deberá cambiar la clave en el primer ingreso.`);
}

main().catch((e) => {
  console.error(`\nError: ${e.message}`);
  process.exit(1);
});
