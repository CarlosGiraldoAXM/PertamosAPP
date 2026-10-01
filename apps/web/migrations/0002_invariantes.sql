-- Invariantes que la base hace cumplir por sí misma. No hay cálculo financiero:
-- solo sumas de control y reglas de integridad. Ver SPEC.md §6.

-- ---------------------------------------------------------------------------
-- 1. El libro contable es inmutable.
-- ---------------------------------------------------------------------------
create trigger pagos_sin_update before update on pagos
begin select raise(abort, 'El libro contable es inmutable: los pagos no se modifican. Registre un reverso.'); end;
create trigger pagos_sin_delete before delete on pagos
begin select raise(abort, 'El libro contable es inmutable: los pagos no se borran. Registre un reverso.'); end;

create trigger aplicaciones_sin_update before update on aplicaciones
begin select raise(abort, 'El libro contable es inmutable: las aplicaciones no se modifican.'); end;
create trigger aplicaciones_sin_delete before delete on aplicaciones
begin select raise(abort, 'El libro contable es inmutable: las aplicaciones no se borran.'); end;

create trigger reparto_socios_sin_update before update on reparto_socios
begin select raise(abort, 'El libro contable es inmutable: el reparto no se modifica.'); end;
create trigger reparto_socios_sin_delete before delete on reparto_socios
begin select raise(abort, 'El libro contable es inmutable: el reparto no se borra.'); end;

create trigger pagos_verificados_sin_delete before delete on pagos_verificados
begin select raise(abort, 'El libro contable es inmutable: la verificación de un pago no se borra.'); end;

-- ---------------------------------------------------------------------------
-- 2. Las condiciones del préstamo y sus socios se congelan con el primer pago.
--    El estado y las notas sí se pueden cambiar.
-- ---------------------------------------------------------------------------
create trigger prestamos_condiciones_congeladas
before update of id, cliente_id, capital_inicial, tasa_mensual_bp, fecha_desembolso, plazo_meses on prestamos
when exists (select 1 from pagos where prestamo_id = old.id)
begin select raise(abort, 'Las condiciones de un préstamo con pagos no se pueden modificar'); end;

create trigger prestamos_con_pagos_sin_delete before delete on prestamos
when exists (select 1 from pagos where prestamo_id = old.id)
begin select raise(abort, 'No se puede borrar un préstamo con pagos registrados'); end;

create trigger prestamo_socios_congelados_insert before insert on prestamo_socios
when exists (select 1 from pagos where prestamo_id = new.prestamo_id)
begin select raise(abort, 'Los socios de un préstamo con pagos no se pueden modificar'); end;

create trigger prestamo_socios_congelados_update before update on prestamo_socios
when exists (select 1 from pagos where prestamo_id = old.prestamo_id)
  or new.prestamo_id <> old.prestamo_id or new.socio_id <> old.socio_id
begin select raise(abort, 'Los socios de un préstamo con pagos no se pueden modificar'); end;

create trigger prestamo_socios_congelados_delete before delete on prestamo_socios
when exists (select 1 from pagos where prestamo_id = old.prestamo_id)
begin select raise(abort, 'Los socios de un préstamo con pagos no se pueden modificar'); end;

-- ---------------------------------------------------------------------------
-- 3. Reglas de cada pago al insertarlo.
-- ---------------------------------------------------------------------------
create trigger pagos_validar_nuevo before insert on pagos
begin
  -- Consecutivo sin huecos: quien escribe debe haber leído el libro completo.
  select raise(abort, 'CONFLICTO_SECUENCIA: el número del movimiento no es el siguiente del préstamo')
  where new.numero <> (select coalesce(max(numero), 0) + 1 from pagos where prestamo_id = new.prestamo_id);

  select raise(abort, 'La fecha del pago es anterior al desembolso')
  where new.fecha < (select fecha_desembolso from prestamos where id = new.prestamo_id);

  select raise(abort, 'El reverso debe ser del mismo préstamo que el pago original')
  where new.tipo = 'reverso'
    and not exists (select 1 from pagos o where o.id = new.reversa_de and o.prestamo_id = new.prestamo_id);

  select raise(abort, 'Un reverso no se puede reversar')
  where new.tipo = 'reverso' and (select tipo from pagos where id = new.reversa_de) = 'reverso';

  select raise(abort, 'El reverso debe ser por el monto exacto del pago original')
  where new.tipo = 'reverso' and new.monto <> -(select monto from pagos where id = new.reversa_de);

  select raise(abort, 'El reverso no puede ser anterior al pago original')
  where new.tipo = 'reverso' and new.fecha < (select fecha from pagos where id = new.reversa_de);
end;

-- ---------------------------------------------------------------------------
-- 4. Cierre del préstamo: las tasas y los aportes de los socios cuadran.
-- ---------------------------------------------------------------------------
create trigger prestamos_verificar_cierre before insert on prestamos_verificados
begin
  select raise(abort, 'Las tasas de los socios no suman la tasa del préstamo')
  where (select coalesce(sum(tasa_bp), 0) from prestamo_socios where prestamo_id = new.prestamo_id)
     <> (select tasa_mensual_bp from prestamos where id = new.prestamo_id);

  select raise(abort, 'Los aportes de los socios no suman el capital del préstamo')
  where (select coalesce(sum(aporte_capital), 0) from prestamo_socios where prestamo_id = new.prestamo_id)
     <> (select capital_inicial from prestamos where id = new.prestamo_id);
end;

-- ---------------------------------------------------------------------------
-- 5. Cierre del asiento: Σ aplicaciones = monto del pago, Σ reparto = aplicación,
--    signos coherentes y el reparto solo incluye socios del préstamo.
-- ---------------------------------------------------------------------------
create trigger pagos_verificar_cierre before insert on pagos_verificados
begin
  select raise(abort, 'Las aplicaciones no suman el monto del pago')
  where (select coalesce(sum(a_interes + a_capital), 0) from aplicaciones where pago_id = new.pago_id)
     <> (select monto from pagos where id = new.pago_id)
     or not exists (select 1 from aplicaciones where pago_id = new.pago_id);

  select raise(abort, 'Una aplicación tiene el signo incorrecto')
  where exists (
    select 1 from aplicaciones a join pagos p on p.id = a.pago_id
    where a.pago_id = new.pago_id
      and ((p.tipo = 'reverso' and (a.a_interes > 0 or a.a_capital > 0))
        or (p.tipo <> 'reverso' and (a.a_interes < 0 or a.a_capital < 0)))
  );

  select raise(abort, 'El reparto entre socios no cuadra con la aplicación')
  where exists (
    select 1 from aplicaciones a
    where a.pago_id = new.pago_id
      and (a.a_interes <> (select coalesce(sum(r.interes), 0) from reparto_socios r where r.aplicacion_id = a.id)
        or a.a_capital <> (select coalesce(sum(r.capital), 0) from reparto_socios r where r.aplicacion_id = a.id))
  );

  select raise(abort, 'El reparto incluye un socio que no es del préstamo')
  where exists (
    select 1
    from reparto_socios r
    join aplicaciones a on a.id = r.aplicacion_id
    join pagos p on p.id = a.pago_id
    where a.pago_id = new.pago_id
      and not exists (select 1 from prestamo_socios ps where ps.prestamo_id = p.prestamo_id and ps.socio_id = r.socio_id)
  );
end;
