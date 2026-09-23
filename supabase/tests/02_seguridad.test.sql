-- RLS y privilegios. Corre con `npx supabase test db` sobre la base local con seed.
begin;
select plan(20);

\set admin    '''00000000-0000-4000-8000-000000000001'''
\set consulta '''00000000-0000-4000-8000-000000000002'''
\set cliente  '''20000000-0000-4000-8000-000000000001'''
\set prestamo '''30000000-0000-4000-8000-000000000001'''

-- Actuar como un usuario autenticado concreto.
create function pg_temp.como(p_usuario uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_usuario, 'role', 'authenticated')::text, true);
  set local role authenticated;
$$;

-- ---------------------------------------------------------------- RLS activa en todo
select is(
  (select count(*)::int from pg_tables where schemaname = 'public' and not rowsecurity),
  0, 'todas las tablas de public tienen RLS activada');

select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename in ('pagos', 'aplicaciones', 'reparto_socios', 'prestamos', 'prestamo_socios') and cmd <> 'SELECT'),
  0, 'el libro y los préstamos no tienen políticas de escritura');

-- ---------------------------------------------------------------- anónimo
set local role anon;
select throws_ok('select * from public.clientes', '42501', null, 'anon no puede leer clientes');
select throws_ok('select * from public.pagos', '42501', null, 'anon no puede leer pagos');
reset role;

-- ---------------------------------------------------------------- consulta
select pg_temp.como(:consulta);
select is((select count(*)::int from public.clientes where documento = '1000000001'), 1, 'consulta lee clientes');
select is((select count(*)::int from public.prestamo_socios where prestamo_id = :prestamo), 2, 'consulta lee los socios del préstamo');
select is((select count(*)::int from public.usuarios), 1, 'consulta solo se ve a sí mismo en usuarios');
select throws_ok(
  $$insert into public.clientes (nombre) values ('Intruso')$$,
  '42501', null, 'consulta no puede crear clientes');
select throws_ok(
  format($$insert into public.pagos (prestamo_id, tipo, fecha, monto, creado_por) values (%L, 'pago', '2026-02-15', 30000, %L)$$, :prestamo, :consulta),
  '42501', null, 'consulta no puede registrar pagos');
select lives_ok('select public.marcar_clave_cambiada()', 'un usuario puede marcar su propia clave como cambiada');
reset role;

-- ---------------------------------------------------------------- admin
select pg_temp.como(:admin);
select is((select count(*)::int from public.usuarios), 2, 'el admin ve todos los usuarios');
select lives_ok(
  $$insert into public.clientes (nombre, documento) values ('Cliente nuevo', '999')$$,
  'el admin crea clientes');
select lives_ok(
  $$update public.clientes set telefono = '3001234567' where documento = '999'$$,
  'el admin edita clientes');
select throws_ok(
  $$delete from public.clientes where documento = '999'$$,
  '42501', null, 'nadie borra clientes desde el navegador');
select throws_ok(
  format($$insert into public.prestamos (cliente_id, capital_inicial, tasa_mensual_bp, fecha_desembolso, creado_por) values (%L, 1000, 300, '2026-01-01', %L)$$, :cliente, :admin),
  '42501', null, 'ni el admin crea préstamos desde el navegador (van por Edge Function)');
select throws_ok(
  format($$insert into public.pagos (prestamo_id, tipo, fecha, monto, creado_por) values (%L, 'pago', '2026-02-15', 30000, %L)$$, :prestamo, :admin),
  '42501', null, 'ni el admin registra pagos desde el navegador');
select throws_ok(
  $$update public.usuarios set rol = 'admin'$$,
  '42501', null, 'nadie se cambia el rol desde el navegador');
reset role;

-- ---------------------------------------------------------------- usuario desactivado
update public.usuarios set activo = false where id = :consulta;
select pg_temp.como(:consulta);
select is((select count(*)::int from public.clientes), 0, 'un usuario desactivado no ve nada');
reset role;

-- ---------------------------------------------------------------- usuario sin fila en usuarios
-- (p. ej. alguien que entró con una cuenta Google no vinculada)
select pg_temp.como('00000000-0000-4000-8000-00000000ffff');
select is((select count(*)::int from public.prestamos), 0, 'un usuario autenticado sin registro no ve nada');
reset role;

-- ---------------------------------------------------------------- storage
select is(
  (select public from storage.buckets where id = 'soportes'),
  false, 'el bucket de soportes es privado');

select * from finish();
rollback;
