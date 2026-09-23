-- Invariantes de la base. Corre con `npx supabase test db` sobre la base local con seed.
begin;
select plan(17);

-- Constantes del seed.
\set admin    '''00000000-0000-4000-8000-000000000001'''
\set socio_a  '''10000000-0000-4000-8000-000000000001'''
\set socio_b  '''10000000-0000-4000-8000-000000000002'''
\set cliente  '''20000000-0000-4000-8000-000000000001'''
\set prestamo '''30000000-0000-4000-8000-000000000001'''

-- ---------------------------------------------------------------- socios
savepoint s;
insert into public.prestamos (id, cliente_id, capital_inicial, tasa_mensual_bp, fecha_desembolso, creado_por)
values ('30000000-0000-4000-8000-0000000000aa', :cliente, 500000, 300, '2026-02-01', :admin);
insert into public.prestamo_socios values
  ('30000000-0000-4000-8000-0000000000aa', :socio_a, 100, 200000),
  ('30000000-0000-4000-8000-0000000000aa', :socio_b, 100, 300000);
select throws_like('set constraints all immediate', '%tasas de los socios suman 200 bp%', 'tasas de socios que no suman la tasa del préstamo');
rollback to savepoint s;
set constraints all deferred;

savepoint s;
insert into public.prestamos (id, cliente_id, capital_inicial, tasa_mensual_bp, fecha_desembolso, creado_por)
values ('30000000-0000-4000-8000-0000000000aa', :cliente, 500000, 300, '2026-02-01', :admin);
insert into public.prestamo_socios values
  ('30000000-0000-4000-8000-0000000000aa', :socio_a, 100, 200000),
  ('30000000-0000-4000-8000-0000000000aa', :socio_b, 200, 200000);
select throws_like('set constraints all immediate', '%aportes de los socios suman 400000%', 'aportes que no suman el capital');
rollback to savepoint s;
set constraints all deferred;

savepoint s;
insert into public.prestamos (id, cliente_id, capital_inicial, tasa_mensual_bp, fecha_desembolso, creado_por)
values ('30000000-0000-4000-8000-0000000000aa', :cliente, 500000, 300, '2026-02-01', :admin);
select throws_like('set constraints all immediate', '%tasas de los socios suman 0 bp%', 'préstamo sin socios');
rollback to savepoint s;
set constraints all deferred;

savepoint s;
insert into public.prestamos (id, cliente_id, capital_inicial, tasa_mensual_bp, fecha_desembolso, creado_por)
values ('30000000-0000-4000-8000-0000000000aa', :cliente, 500000, 300, '2026-02-01', :admin);
insert into public.prestamo_socios values
  ('30000000-0000-4000-8000-0000000000aa', :socio_a, 100, 200000),
  ('30000000-0000-4000-8000-0000000000aa', :socio_b, 200, 300000);
select lives_ok('set constraints all immediate', 'socios que cuadran se aceptan');
rollback to savepoint s;
set constraints all deferred;

-- ---------------------------------------------------------------- un asiento válido
-- Pago del primer mes: 30.000 → 10.000 socio A, 20.000 socio B.
insert into public.pagos (id, prestamo_id, tipo, fecha, monto, creado_por)
values ('40000000-0000-4000-8000-000000000001', :prestamo, 'pago', '2026-02-15', 30000, :admin);
insert into public.aplicaciones (id, pago_id, periodo, a_interes)
values ('50000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 1, 30000);
insert into public.reparto_socios (aplicacion_id, socio_id, interes) values
  ('50000000-0000-4000-8000-000000000001', :socio_a, 10000),
  ('50000000-0000-4000-8000-000000000001', :socio_b, 20000);
select lives_ok('set constraints all immediate', 'un asiento que cuadra se acepta');
set constraints all deferred;

-- ---------------------------------------------------------------- inmutabilidad
select throws_like(
  $$update public.pagos set monto = 1 where id = '40000000-0000-4000-8000-000000000001'$$,
  '%libro contable es inmutable%', 'no se puede modificar un pago (ni siquiera como postgres)');
select throws_like(
  $$delete from public.aplicaciones where id = '50000000-0000-4000-8000-000000000001'$$,
  '%libro contable es inmutable%', 'no se puede borrar una aplicación');
select throws_like('truncate public.reparto_socios cascade', '%libro contable es inmutable%', 'no se puede truncar el reparto');

-- ---------------------------------------------------------------- condiciones congeladas
select throws_like(
  format('update public.prestamos set tasa_mensual_bp = 400 where id = %L', :prestamo),
  '%condiciones de un préstamo con pagos%', 'no se cambian las condiciones de un préstamo con pagos');
select lives_ok(
  format($$update public.prestamos set estado = 'castigado', notas = 'x' where id = %L$$, :prestamo),
  'el estado y las notas sí se pueden cambiar');
select throws_like(
  format('update public.prestamo_socios set tasa_bp = 150 where prestamo_id = %L and socio_id = %L', :prestamo, :socio_a),
  '%socios de un préstamo con pagos%', 'no se cambian los socios de un préstamo con pagos');

-- ---------------------------------------------------------------- asientos que no cuadran
savepoint s;
insert into public.pagos (id, prestamo_id, tipo, fecha, monto, creado_por)
values ('40000000-0000-4000-8000-000000000002', :prestamo, 'pago', '2026-03-15', 30000, :admin);
insert into public.aplicaciones (id, pago_id, periodo, a_interes)
values ('50000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000002', 2, 29000);
insert into public.reparto_socios (aplicacion_id, socio_id, interes)
values ('50000000-0000-4000-8000-000000000002', :socio_a, 29000);
select throws_like('set constraints all immediate', '%aplicaciones suman 29000 y el monto es 30000%', 'aplicaciones que no suman el monto');
rollback to savepoint s;
set constraints all deferred;

savepoint s;
insert into public.pagos (id, prestamo_id, tipo, fecha, monto, creado_por)
values ('40000000-0000-4000-8000-000000000002', :prestamo, 'pago', '2026-03-15', 30000, :admin);
insert into public.aplicaciones (id, pago_id, periodo, a_interes)
values ('50000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000002', 2, 30000);
insert into public.reparto_socios (aplicacion_id, socio_id, interes)
values ('50000000-0000-4000-8000-000000000002', :socio_a, 10000);
select throws_like('set constraints all immediate', '%reparto entre socios no cuadra%', 'reparto que no cuadra con la aplicación');
rollback to savepoint s;
set constraints all deferred;

-- ---------------------------------------------------------------- reversos
select throws_like(
  format($$insert into public.pagos (prestamo_id, tipo, fecha, monto, reversa_de, creado_por)
           values (%L, 'reverso', '2026-02-16', -29000, '40000000-0000-4000-8000-000000000001', %L)$$, :prestamo, :admin),
  '%monto exacto%', 'un reverso por otro monto se rechaza');

savepoint s;
insert into public.pagos (id, prestamo_id, tipo, fecha, monto, reversa_de, creado_por)
values ('40000000-0000-4000-8000-000000000003', :prestamo, 'reverso', '2026-02-16', -30000,
        '40000000-0000-4000-8000-000000000001', :admin);
insert into public.aplicaciones (id, pago_id, periodo, a_interes)
values ('50000000-0000-4000-8000-000000000003', '40000000-0000-4000-8000-000000000003', 1, -30000);
insert into public.reparto_socios (aplicacion_id, socio_id, interes) values
  ('50000000-0000-4000-8000-000000000003', :socio_a, -10000),
  ('50000000-0000-4000-8000-000000000003', :socio_b, -20000);
select lives_ok('set constraints all immediate', 'un reverso espejo se acepta');
set constraints all deferred;
select throws_ok(
  format($$insert into public.pagos (prestamo_id, tipo, fecha, monto, reversa_de, creado_por)
           values (%L, 'reverso', '2026-02-17', -30000, '40000000-0000-4000-8000-000000000001', %L)$$, :prestamo, :admin),
  '23505', null, 'un pago no se puede reversar dos veces');
rollback to savepoint s;
set constraints all deferred;

select throws_like(
  format($$insert into public.pagos (prestamo_id, tipo, fecha, monto, creado_por)
           values (%L, 'pago', '2026-01-01', 1000, %L)$$, :prestamo, :admin),
  '%anterior al desembolso%', 'un pago anterior al desembolso se rechaza');

select * from finish();
rollback;
