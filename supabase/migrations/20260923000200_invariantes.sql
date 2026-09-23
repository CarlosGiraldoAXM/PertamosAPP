-- Invariantes que la base hace cumplir por sí misma, sin importar quién escriba
-- (Edge Functions, dashboard o SQL directo). No hay cálculo financiero aquí:
-- solo sumas de control y reglas de integridad. Ver SPEC.md §6.

-- ---------------------------------------------------------------------------
-- 1. Las tasas y los aportes de los socios cuadran con el préstamo (al commit).
-- ---------------------------------------------------------------------------
create function public.verificar_socios_prestamo()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_id           uuid;
  v_tasa         integer;
  v_capital      bigint;
  v_suma_tasa    bigint;
  v_suma_capital bigint;
begin
  if tg_table_name = 'prestamos' then
    v_id := new.id;
  elsif tg_op = 'DELETE' then
    v_id := old.prestamo_id;
  else
    v_id := new.prestamo_id;
  end if;

  select p.tasa_mensual_bp, p.capital_inicial into v_tasa, v_capital
  from public.prestamos p where p.id = v_id;
  if not found then
    return null;
  end if;

  select coalesce(sum(ps.tasa_bp), 0), coalesce(sum(ps.aporte_capital), 0)
  into v_suma_tasa, v_suma_capital
  from public.prestamo_socios ps where ps.prestamo_id = v_id;

  if v_suma_tasa <> v_tasa then
    raise exception using
      errcode = '23514',
      message = format('Préstamo %s: las tasas de los socios suman %s bp y la del préstamo es %s bp', v_id, v_suma_tasa, v_tasa);
  end if;
  if v_suma_capital <> v_capital then
    raise exception using
      errcode = '23514',
      message = format('Préstamo %s: los aportes de los socios suman %s y el capital es %s', v_id, v_suma_capital, v_capital);
  end if;
  return null;
end;
$$;

create constraint trigger prestamos_socios_cuadran
  after insert or update of capital_inicial, tasa_mensual_bp on public.prestamos
  deferrable initially deferred
  for each row execute function public.verificar_socios_prestamo();

create constraint trigger prestamo_socios_cuadran
  after insert or update or delete on public.prestamo_socios
  deferrable initially deferred
  for each row execute function public.verificar_socios_prestamo();

-- ---------------------------------------------------------------------------
-- 2. Las condiciones del préstamo y sus socios se congelan con el primer pago.
-- ---------------------------------------------------------------------------
create function public.proteger_condiciones_prestamo()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.id is distinct from old.id then
    raise exception using errcode = '42501', message = 'El id de un préstamo no se puede cambiar';
  end if;
  if exists (select 1 from public.pagos pa where pa.prestamo_id = old.id) then
    if tg_op = 'DELETE' then
      raise exception using errcode = '42501', message = 'No se puede borrar un préstamo con pagos registrados';
    end if;
    if (new.cliente_id, new.capital_inicial, new.tasa_mensual_bp, new.fecha_desembolso, new.plazo_meses, new.creado_por)
       is distinct from
       (old.cliente_id, old.capital_inicial, old.tasa_mensual_bp, old.fecha_desembolso, old.plazo_meses, old.creado_por) then
      raise exception using errcode = '42501', message = 'Las condiciones de un préstamo con pagos no se pueden modificar';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger prestamos_proteger_condiciones
  before update or delete on public.prestamos
  for each row execute function public.proteger_condiciones_prestamo();

create function public.proteger_socios_prestamo()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid := case when tg_op = 'INSERT' then new.prestamo_id else old.prestamo_id end;
begin
  if tg_op = 'UPDATE' and (new.prestamo_id, new.socio_id) is distinct from (old.prestamo_id, old.socio_id) then
    raise exception using errcode = '42501', message = 'No se puede cambiar el préstamo o el socio de una participación';
  end if;
  if exists (select 1 from public.pagos pa where pa.prestamo_id = v_id) then
    raise exception using errcode = '42501', message = 'Los socios de un préstamo con pagos no se pueden modificar';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger prestamo_socios_proteger
  before insert or update or delete on public.prestamo_socios
  for each row execute function public.proteger_socios_prestamo();

-- ---------------------------------------------------------------------------
-- 3. El libro contable es inmutable, también para roles que saltan RLS.
-- ---------------------------------------------------------------------------
create function public.libro_inmutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using
    errcode = '42501',
    message = format('El libro contable es inmutable: %s sobre %s no está permitido. Registre un reverso.', tg_op, tg_table_name);
end;
$$;

create trigger pagos_inmutable before update or delete on public.pagos
  for each row execute function public.libro_inmutable();
create trigger pagos_sin_truncate before truncate on public.pagos
  for each statement execute function public.libro_inmutable();
create trigger aplicaciones_inmutable before update or delete on public.aplicaciones
  for each row execute function public.libro_inmutable();
create trigger aplicaciones_sin_truncate before truncate on public.aplicaciones
  for each statement execute function public.libro_inmutable();
create trigger reparto_socios_inmutable before update or delete on public.reparto_socios
  for each row execute function public.libro_inmutable();
create trigger reparto_socios_sin_truncate before truncate on public.reparto_socios
  for each statement execute function public.libro_inmutable();

-- ---------------------------------------------------------------------------
-- 4. Reglas de cada pago al insertarlo.
-- ---------------------------------------------------------------------------
create function public.validar_pago_nuevo()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_desembolso date;
  v_original   public.pagos;
begin
  select p.fecha_desembolso into v_desembolso from public.prestamos p where p.id = new.prestamo_id;
  if new.fecha < v_desembolso then
    raise exception using errcode = '23514', message = 'La fecha del pago es anterior al desembolso';
  end if;

  if new.tipo = 'reverso' then
    select * into v_original from public.pagos pa where pa.id = new.reversa_de;
    if v_original.prestamo_id is distinct from new.prestamo_id then
      raise exception using errcode = '23514', message = 'El reverso debe ser del mismo préstamo que el pago original';
    end if;
    if v_original.tipo = 'reverso' then
      raise exception using errcode = '23514', message = 'Un reverso no se puede reversar';
    end if;
    if new.monto <> -v_original.monto then
      raise exception using errcode = '23514', message = 'El reverso debe ser por el monto exacto del pago original';
    end if;
    if new.fecha < v_original.fecha then
      raise exception using errcode = '23514', message = 'El reverso no puede ser anterior al pago original';
    end if;
  end if;
  return new;
end;
$$;

create trigger pagos_validar_nuevo
  before insert on public.pagos
  for each row execute function public.validar_pago_nuevo();

-- ---------------------------------------------------------------------------
-- 5. Sumas de control del asiento completo (al commit):
--    Σ aplicaciones = monto del pago, Σ reparto = aplicación, signos coherentes,
--    y el reparto solo incluye socios del préstamo.
-- ---------------------------------------------------------------------------
create function public.verificar_pago(p_pago_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_pago  public.pagos;
  v_signo integer;
  v_suma  bigint;
  v_n     integer;
begin
  select * into v_pago from public.pagos pa where pa.id = p_pago_id;
  v_signo := case when v_pago.tipo = 'reverso' then -1 else 1 end;

  select coalesce(sum(a.a_interes + a.a_capital), 0), count(*) into v_suma, v_n
  from public.aplicaciones a where a.pago_id = p_pago_id;
  if v_n = 0 or v_suma <> v_pago.monto then
    raise exception using
      errcode = '23514',
      message = format('Pago %s: las aplicaciones suman %s y el monto es %s', p_pago_id, v_suma, v_pago.monto);
  end if;

  if exists (
    select 1 from public.aplicaciones a
    where a.pago_id = p_pago_id and (a.a_interes * v_signo < 0 or a.a_capital * v_signo < 0)
  ) then
    raise exception using errcode = '23514', message = format('Pago %s: una aplicación tiene el signo incorrecto', p_pago_id);
  end if;
end;
$$;

create function public.verificar_aplicacion(p_aplicacion_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_aplicacion public.aplicaciones;
  v_interes    bigint;
  v_capital    bigint;
  v_n          integer;
begin
  select * into v_aplicacion from public.aplicaciones a where a.id = p_aplicacion_id;

  select coalesce(sum(r.interes), 0), coalesce(sum(r.capital), 0), count(*) into v_interes, v_capital, v_n
  from public.reparto_socios r where r.aplicacion_id = p_aplicacion_id;
  if v_n = 0 or v_interes <> v_aplicacion.a_interes or v_capital <> v_aplicacion.a_capital then
    raise exception using
      errcode = '23514',
      message = format('Aplicación %s: el reparto entre socios no cuadra', p_aplicacion_id);
  end if;

  if exists (
    select 1
    from public.reparto_socios r
    join public.pagos pa on pa.id = v_aplicacion.pago_id
    where r.aplicacion_id = p_aplicacion_id
      and not exists (
        select 1 from public.prestamo_socios ps
        where ps.prestamo_id = pa.prestamo_id and ps.socio_id = r.socio_id
      )
  ) then
    raise exception using
      errcode = '23514',
      message = format('Aplicación %s: el reparto incluye un socio que no es del préstamo', p_aplicacion_id);
  end if;
end;
$$;

create function public.verificar_asiento()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  case tg_table_name
    when 'pagos' then
      perform public.verificar_pago(new.id);
    when 'aplicaciones' then
      perform public.verificar_pago(new.pago_id);
      perform public.verificar_aplicacion(new.id);
    when 'reparto_socios' then
      perform public.verificar_aplicacion(new.aplicacion_id);
  end case;
  return null;
end;
$$;

create constraint trigger pagos_asiento_cuadra
  after insert on public.pagos
  deferrable initially deferred
  for each row execute function public.verificar_asiento();
create constraint trigger aplicaciones_asiento_cuadra
  after insert on public.aplicaciones
  deferrable initially deferred
  for each row execute function public.verificar_asiento();
create constraint trigger reparto_socios_asiento_cuadra
  after insert on public.reparto_socios
  deferrable initially deferred
  for each row execute function public.verificar_asiento();
