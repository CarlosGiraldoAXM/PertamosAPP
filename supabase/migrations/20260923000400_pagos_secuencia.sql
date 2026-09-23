-- Orden de registro de los movimientos. `core` reconstruye el libro en este
-- orden (los reversos son LIFO); created_at puede empatar entre transacciones.
alter table public.pagos
  add column secuencia bigint generated always as identity;

alter table public.pagos
  add constraint pagos_secuencia_unica unique (secuencia);

create index pagos_prestamo_secuencia_idx on public.pagos (prestamo_id, secuencia);
