-- Schema base del sistema de préstamos. Ver SPEC.md §6.
-- Montos en pesos enteros (bigint), tasas en puntos básicos (integer), fechas de negocio en date.

create type public.estado_prestamo as enum ('activo', 'pagado', 'castigado');
create type public.rol_usuario     as enum ('admin', 'consulta');
create type public.tipo_pago       as enum ('pago', 'liquidacion', 'reverso');

-- Quién entra al sistema. La clave vive en auth.users (hash), nunca aquí.
create table public.usuarios (
  id                 uuid primary key references auth.users (id) on delete cascade,
  email              text not null unique,
  email_google       text unique,
  nombre             text not null,
  rol                public.rol_usuario not null default 'consulta',
  activo             boolean not null default true,
  debe_cambiar_clave boolean not null default true,
  created_at         timestamptz not null default now()
);

-- Dueños de la plata. Un socio puede no tener usuario.
create table public.socios (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null check (btrim(nombre) <> ''),
  usuario_id uuid unique references public.usuarios (id),
  activo     boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.clientes (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null check (btrim(nombre) <> ''),
  documento  text unique,
  telefono   text,
  direccion  text,
  notas      text,
  created_at timestamptz not null default now()
);

create table public.prestamos (
  id               uuid primary key default gen_random_uuid(),
  cliente_id       uuid not null references public.clientes (id),
  capital_inicial  bigint  not null check (capital_inicial > 0),
  tasa_mensual_bp  integer not null check (tasa_mensual_bp > 0),
  fecha_desembolso date    not null,
  plazo_meses      integer check (plazo_meses between 1 and 600),  -- null = capital "cuando pueda"
  estado           public.estado_prestamo not null default 'activo',
  notas            text,
  creado_por       uuid not null references public.usuarios (id),
  created_at       timestamptz not null default now()
);

create table public.prestamo_socios (
  prestamo_id    uuid not null references public.prestamos (id),
  socio_id       uuid not null references public.socios (id),
  tasa_bp        integer not null check (tasa_bp >= 0),
  aporte_capital bigint  not null check (aporte_capital >= 0),
  primary key (prestamo_id, socio_id)
);

create table public.pagos (
  id           uuid primary key default gen_random_uuid(),
  prestamo_id  uuid not null references public.prestamos (id),
  tipo         public.tipo_pago not null,
  fecha        date not null,
  monto        bigint not null,
  medio        text,
  nota         text,
  reversa_de   uuid unique references public.pagos (id),  -- unique: un pago se reversa una sola vez
  soporte_path text,                                      -- ruta en el bucket privado `soportes`
  creado_por   uuid not null references public.usuarios (id),
  created_at   timestamptz not null default now(),
  check ((tipo = 'reverso') = (reversa_de is not null)),
  check ((tipo = 'reverso' and monto < 0) or (tipo <> 'reverso' and monto > 0))
);

-- Cómo se imputó cada pago. periodo = número de corte para interés; null para capital.
create table public.aplicaciones (
  id        uuid primary key default gen_random_uuid(),
  pago_id   uuid not null references public.pagos (id),
  periodo   integer check (periodo > 0),
  a_interes bigint not null default 0,
  a_capital bigint not null default 0,
  check ((periodo is not null and a_capital = 0) or (periodo is null and a_interes = 0))
);

-- Reparto de cada aplicación entre socios (calculado por core, congelado para auditoría).
create table public.reparto_socios (
  aplicacion_id uuid not null references public.aplicaciones (id),
  socio_id      uuid not null references public.socios (id),
  interes       bigint not null default 0,
  capital       bigint not null default 0,
  primary key (aplicacion_id, socio_id)
);

create index prestamos_cliente_idx      on public.prestamos (cliente_id);
create index prestamos_estado_idx       on public.prestamos (estado);
create index prestamo_socios_socio_idx  on public.prestamo_socios (socio_id);
create index pagos_prestamo_fecha_idx   on public.pagos (prestamo_id, fecha);
create index aplicaciones_pago_idx      on public.aplicaciones (pago_id);
create index reparto_socios_socio_idx   on public.reparto_socios (socio_id);
