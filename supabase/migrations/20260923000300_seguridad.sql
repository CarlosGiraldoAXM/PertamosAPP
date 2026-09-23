-- Seguridad: RLS en todas las tablas, helpers de rol, auth y storage. Ver SPEC.md §7.
-- Regla general: cualquier usuario activo lee todo; el admin escribe clientes y
-- socios; el libro contable y los préstamos solo los escriben las Edge Functions
-- (conexión privilegiada), nunca el navegador.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create function public.es_usuario_activo()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.usuarios u where u.id = auth.uid() and u.activo);
$$;

create function public.es_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.usuarios u where u.id = auth.uid() and u.activo and u.rol = 'admin');
$$;

-- La UI la llama después de que el usuario cambia su clave inicial.
create function public.marcar_clave_cambiada()
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.usuarios set debe_cambiar_clave = false where id = auth.uid();
$$;

revoke execute on function public.es_usuario_activo(), public.es_admin(), public.marcar_clave_cambiada() from public, anon;
grant execute on function public.es_usuario_activo(), public.es_admin(), public.marcar_clave_cambiada() to authenticated;

-- Las funciones de invariantes son internas: nadie las llama por la API.
revoke execute on function
  public.verificar_socios_prestamo(), public.proteger_condiciones_prestamo(), public.proteger_socios_prestamo(),
  public.libro_inmutable(), public.validar_pago_nuevo(), public.verificar_pago(uuid),
  public.verificar_aplicacion(uuid), public.verificar_asiento()
from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Privilegios de tabla (defensa en profundidad además de RLS)
-- ---------------------------------------------------------------------------
revoke all on
  public.usuarios, public.socios, public.clientes, public.prestamos,
  public.prestamo_socios, public.pagos, public.aplicaciones, public.reparto_socios
from anon;

revoke insert, update, delete, truncate on
  public.usuarios, public.prestamos, public.prestamo_socios,
  public.pagos, public.aplicaciones, public.reparto_socios
from authenticated;

revoke delete, truncate on public.clientes, public.socios from authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.usuarios        enable row level security;
alter table public.socios          enable row level security;
alter table public.clientes        enable row level security;
alter table public.prestamos       enable row level security;
alter table public.prestamo_socios enable row level security;
alter table public.pagos           enable row level security;
alter table public.aplicaciones    enable row level security;
alter table public.reparto_socios  enable row level security;

create policy "usuarios: cada uno se ve a sí mismo; el admin ve a todos"
  on public.usuarios for select to authenticated
  using (id = (select auth.uid()) or (select public.es_admin()));

create policy "socios: lectura usuarios activos"
  on public.socios for select to authenticated using ((select public.es_usuario_activo()));
create policy "socios: alta admin"
  on public.socios for insert to authenticated with check ((select public.es_admin()));
create policy "socios: edición admin"
  on public.socios for update to authenticated
  using ((select public.es_admin())) with check ((select public.es_admin()));

create policy "clientes: lectura usuarios activos"
  on public.clientes for select to authenticated using ((select public.es_usuario_activo()));
create policy "clientes: alta admin"
  on public.clientes for insert to authenticated with check ((select public.es_admin()));
create policy "clientes: edición admin"
  on public.clientes for update to authenticated
  using ((select public.es_admin())) with check ((select public.es_admin()));

-- Préstamos y libro contable: solo lectura desde el navegador. Sin políticas de
-- INSERT, UPDATE ni DELETE: no existen.
create policy "prestamos: lectura usuarios activos"
  on public.prestamos for select to authenticated using ((select public.es_usuario_activo()));
create policy "prestamo_socios: lectura usuarios activos"
  on public.prestamo_socios for select to authenticated using ((select public.es_usuario_activo()));
create policy "pagos: lectura usuarios activos"
  on public.pagos for select to authenticated using ((select public.es_usuario_activo()));
create policy "aplicaciones: lectura usuarios activos"
  on public.aplicaciones for select to authenticated using ((select public.es_usuario_activo()));
create policy "reparto_socios: lectura usuarios activos"
  on public.reparto_socios for select to authenticated using ((select public.es_usuario_activo()));

-- ---------------------------------------------------------------------------
-- Auth: al vincular una cuenta Google se guarda su correo en usuarios.email_google
-- ---------------------------------------------------------------------------
create function public.sincronizar_identidad_google()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and new.provider = 'google' then
    update public.usuarios set email_google = new.identity_data ->> 'email' where id = new.user_id;
  elsif tg_op = 'DELETE' and old.provider = 'google' then
    update public.usuarios set email_google = null where id = old.user_id;
  end if;
  return null;
end;
$$;

revoke execute on function public.sincronizar_identidad_google() from public, anon, authenticated;

create trigger sincronizar_identidad_google
  after insert or delete on auth.identities
  for each row execute function public.sincronizar_identidad_google();

-- ---------------------------------------------------------------------------
-- Storage: bucket privado para cédulas, pagarés y comprobantes
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'soportes', 'soportes', false, 10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']
)
on conflict (id) do nothing;

create policy "soportes: lectura usuarios activos"
  on storage.objects for select to authenticated
  using (bucket_id = 'soportes' and (select public.es_usuario_activo()));

create policy "soportes: subida admin"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'soportes' and (select public.es_admin()));
