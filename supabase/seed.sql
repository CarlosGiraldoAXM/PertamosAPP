-- Datos de prueba SOLO para la base local (`supabase db reset`).
-- Nunca se sube a producción: `supabase db push` no ejecuta este archivo.
-- Las claves de acá son de desarrollo local y no sirven en el proyecto real.
--
--   admin@local.test     / Admin12345   (rol admin)
--   consulta@local.test  / Consulta12345 (rol consulta)

do $$
declare
  v_admin    uuid := '00000000-0000-4000-8000-000000000001';
  v_consulta uuid := '00000000-0000-4000-8000-000000000002';
  v_usuario  record;
begin
  for v_usuario in
    select * from (values
      (v_admin,    'admin@local.test',    'Admin12345',    'Administrador local', 'admin'::public.rol_usuario),
      (v_consulta, 'consulta@local.test', 'Consulta12345', 'Consulta local',      'consulta'::public.rol_usuario)
    ) as t(id, email, clave, nombre, rol)
  loop
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, email_change, email_change_token_new, recovery_token
    ) values (
      '00000000-0000-0000-0000-000000000000', v_usuario.id, 'authenticated', 'authenticated', v_usuario.email,
      extensions.crypt(v_usuario.clave, extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''
    );
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (
      gen_random_uuid(), v_usuario.id, v_usuario.id::text,
      jsonb_build_object('sub', v_usuario.id::text, 'email', v_usuario.email, 'email_verified', true),
      'email', now(), now(), now()
    );
    insert into public.usuarios (id, email, nombre, rol, debe_cambiar_clave)
    values (v_usuario.id, v_usuario.email, v_usuario.nombre, v_usuario.rol, false);
  end loop;
end;
$$;

insert into public.socios (id, nombre, usuario_id) values
  ('10000000-0000-4000-8000-000000000001', 'Socio A', '00000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000002', 'Socio B', null);

insert into public.clientes (id, nombre, documento, telefono) values
  ('20000000-0000-4000-8000-000000000001', 'Cliente de prueba', '1000000001', '3000000001');

-- $1.000.000 al 3 %: Socio A 1 % y $400.000; Socio B 2 % y $600.000.
insert into public.prestamos (id, cliente_id, capital_inicial, tasa_mensual_bp, fecha_desembolso, creado_por) values
  ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 1000000, 300, '2026-01-15',
   '00000000-0000-4000-8000-000000000001');
insert into public.prestamo_socios (prestamo_id, socio_id, tasa_bp, aporte_capital) values
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 100, 400000),
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', 200, 600000);
