-- Schema del sistema de préstamos en Cloudflare D1 (SQLite). Ver SPEC.md §6.
-- Montos en pesos enteros, tasas en puntos básicos, fechas de negocio como texto YYYY-MM-DD.
-- Las tablas son STRICT: SQLite rechaza valores que no sean del tipo declarado.

create table socios (
  id         text primary key,
  nombre     text not null check (trim(nombre) <> ''),
  activo     integer not null default 1 check (activo in (0, 1)),
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) strict;

create table clientes (
  id         text primary key,
  nombre     text not null check (trim(nombre) <> ''),
  documento  text unique,
  telefono   text,
  direccion  text,
  notas      text,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) strict;

create table prestamos (
  id               text primary key,
  cliente_id       text not null references clientes (id),
  -- Tope 2^53-1: los montos viajan como number de JavaScript y deben ser enteros seguros.
  capital_inicial  integer not null check (capital_inicial between 1 and 9007199254740991),
  tasa_mensual_bp  integer not null check (tasa_mensual_bp > 0),
  fecha_desembolso text not null check (fecha_desembolso glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' and fecha_desembolso = date(fecha_desembolso)),
  plazo_meses      integer check (plazo_meses between 1 and 600),  -- null = capital "cuando pueda"
  estado           text not null default 'activo' check (estado in ('activo', 'pagado', 'castigado')),
  notas            text,
  created_at       text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) strict;

create table prestamo_socios (
  prestamo_id    text not null references prestamos (id),
  socio_id       text not null references socios (id),
  tasa_bp        integer not null check (tasa_bp >= 0),
  aporte_capital integer not null check (aporte_capital >= 0),
  primary key (prestamo_id, socio_id)
) strict;

create table pagos (
  id           text primary key,
  prestamo_id  text not null references prestamos (id),
  -- Consecutivo del movimiento dentro del préstamo: 1, 2, 3… sin huecos. Da el
  -- orden del libro y serializa las escrituras: dos operaciones simultáneas
  -- calculan el mismo número y la segunda choca contra el unique.
  numero       integer not null check (numero > 0),
  tipo         text not null check (tipo in ('pago', 'liquidacion', 'reverso')),
  fecha        text not null check (fecha glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' and fecha = date(fecha)),
  monto        integer not null check (monto between -9007199254740991 and 9007199254740991),
  medio        text,
  nota         text,
  reversa_de   text unique references pagos (id),  -- unique: un pago se reversa una sola vez
  soporte_path text,
  created_at   text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  unique (prestamo_id, numero),
  check ((tipo = 'reverso') = (reversa_de is not null)),
  check ((tipo = 'reverso' and monto < 0) or (tipo <> 'reverso' and monto > 0))
) strict;

-- Cómo se imputó cada pago. periodo = número de corte para interés; null para capital.
create table aplicaciones (
  id        text primary key,
  pago_id   text not null references pagos (id),
  periodo   integer check (periodo > 0),
  a_interes integer not null default 0,
  a_capital integer not null default 0,
  check ((periodo is not null and a_capital = 0) or (periodo is null and a_interes = 0))
) strict;

-- Reparto de cada aplicación entre socios (calculado por core, congelado para auditoría).
create table reparto_socios (
  aplicacion_id text not null references aplicaciones (id),
  socio_id      text not null references socios (id),
  interes       integer not null default 0,
  capital       integer not null default 0,
  primary key (aplicacion_id, socio_id)
) strict;

-- Filas de cierre: el Worker las inserta al final de cada transacción y sus
-- triggers verifican las sumas de control del préstamo o del asiento completo.
create table prestamos_verificados (
  prestamo_id text primary key references prestamos (id)
) strict;

create table pagos_verificados (
  pago_id text primary key references pagos (id)
) strict;

create index prestamos_cliente_idx     on prestamos (cliente_id);
create index prestamos_estado_idx      on prestamos (estado);
create index prestamo_socios_socio_idx on prestamo_socios (socio_id);
create index aplicaciones_pago_idx     on aplicaciones (pago_id);
create index reparto_socios_socio_idx  on reparto_socios (socio_id);
