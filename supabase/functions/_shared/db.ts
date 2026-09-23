import postgres from 'npm:postgres@3.4.7';

export type Sql = postgres.Sql;
export type Tx = postgres.TransactionSql;

let sql: Sql | null = null;

/**
 * Conexión directa a Postgres (SUPABASE_DB_URL), con transacciones
 * interactivas reales para poder bloquear el préstamo con FOR UPDATE.
 * Salta RLS: por eso cada función valida el rol del llamante por su cuenta.
 */
export function db(): Sql {
  if (sql) return sql;
  // PRESTAMOS_DB_URL solo se define en local (config.toml): el host que inyecta
  // la CLI (supabase_db_<proyecto>) tiene guion bajo y el resolvedor de Deno lo rechaza.
  const url = Deno.env.get('PRESTAMOS_DB_URL') ?? Deno.env.get('SUPABASE_DB_URL');
  if (!url) throw new Error('Falta la variable SUPABASE_DB_URL');
  sql = postgres(url, {
    max: 1,
    prepare: false,
    idle_timeout: 20,
    types: {
      // bigint (pesos) → number, validando que sea un entero seguro.
      pesos: {
        to: 20,
        from: [20],
        serialize: (x: number) => String(x),
        parse: (x: string) => {
          const n = Number(x);
          if (!Number.isSafeInteger(n)) throw new Error(`bigint fuera de rango: ${x}`);
          return n;
        },
      },
      // date → 'YYYY-MM-DD' tal cual, nunca un Date de JavaScript.
      fecha: {
        to: 1082,
        from: [1082],
        serialize: (x: string) => x,
        parse: (x: string) => x,
      },
    },
  });
  return sql;
}
