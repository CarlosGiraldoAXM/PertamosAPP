# Prompt inicial — Sistema de gestión de préstamos

> Pegá esto en Claude Code como primer mensaje. Guardalo también en el repo como `SPEC.md`.

---

## 1. Contexto

Voy a construir un sistema de gestión de préstamos para un prestamista particular en Colombia. El negocio es entre **dos socios** que reparten el interés de cada préstamo en proporciones distintas y configurables préstamo por préstamo.

Es un sistema que maneja plata de terceros. La corrección de los cálculos y la trazabilidad importan más que la velocidad de desarrollo o que la UI. No generes toda la app de una vez: primero el motor de cálculo con tests, después la base de datos, después la API, y al final la UI.

## 2. Stack

- **Base de datos:** Supabase (Postgres) — es la fuente de verdad, incluyendo Auth, RLS y Storage
- **Backend:** Supabase Edge Functions (Deno) para las operaciones de escritura que mueven plata
- **Frontend:** React + Vite + TypeScript + Tailwind, desplegado en Cloudflare Pages
- **Cliente de datos:** `supabase-js` para lecturas (protegidas por RLS); las escrituras de dinero van por Edge Function
- **Driver en Edge Functions:** `postgres.js` conectando por Supavisor en **session mode**, no el pooler transaccional — necesito transacciones interactivas reales
- **Tests:** Vitest
- **Migraciones:** Supabase CLI, versionadas en `/supabase/migrations`, nunca cambios a mano desde el dashboard

Estructura del repo:

```
/packages/core        -> motor de cálculo, TypeScript puro, cero dependencias
/supabase/migrations  -> schema versionado
/supabase/functions   -> Edge Functions (importan /packages/core)
/apps/web             -> React + Vite
```

`core` debe correr igual en Node (tests), en Deno (Edge Functions) y en el browser (previews en la UI). Nada de `fetch`, nada de acceso a DB, nada de `Date.now()` adentro: la fecha "hoy" entra siempre como parámetro.

## 3. Reglas no negociables

1. **Dinero en enteros.** Todos los montos se guardan y calculan como enteros en centavos de COP (`BIGINT` en Postgres). Prohibido `float`, `numeric` con decimales o `number` fraccionario para plata. Si necesitás precisión intermedia en la fórmula de amortización usá `decimal.js` y redondeá a entero al salir.
2. **Tasas en puntos básicos.** `500` = 5.00% mensual, como `INTEGER`. Igual para el reparto de cada socio.
3. **El redondeo cuadra siempre.** Escribí `repartirProporcional(total, pesos[]): number[]` donde la última parte absorbe el residuo, con test de que `sum(resultado) === total` para miles de casos generados aleatoriamente.
4. **Fechas calendario.** Vencimientos, desembolsos y pagos son `DATE` en Postgres (sin timezone) y `YYYY-MM-DD` como string en TypeScript. Nunca uses `new Date()` para aritmética de fechas de negocio. Los `created_at` de auditoría sí son `TIMESTAMPTZ`. Zona de referencia: `America/Bogotá`.
5. **El libro contable es inmutable.** Las tablas `pagos` y `aplicaciones` no tienen políticas de `UPDATE` ni `DELETE` en RLS: la inmutabilidad se aplica en la base, no por disciplina del programador. Corregir un error = insertar un asiento de reverso que apunta al original vía `reversa_de`.
6. **Todo movimiento de plata pasa por una transacción con bloqueo.** `BEGIN` → `SELECT ... FROM prestamos WHERE id = $1 FOR UPDATE` → leer estado → calcular → insertar → `COMMIT`. Nunca leer el saldo afuera de la transacción y escribir adentro.
7. **Cero lógica financiera duplicada en SQL.** Los cálculos viven solo en `core`. Postgres guarda, valida invariantes y controla acceso; no amortiza.
8. **Tests antes de la UI.** Cada función de `core` va con sus tests desde el primer commit.

## 4. Schema (Postgres) — punto de partida, proponé mejoras si ves problemas

```sql
create type metodo_amortizacion as enum ('cuota_fija','capital_fijo','solo_interes');
create type politica_abono      as enum ('reducir_plazo','reducir_cuota');
create type estado_prestamo     as enum ('activo','pagado','en_mora','castigado');
create type estado_cuota        as enum ('pendiente','parcial','pagada','vencida');
create type rol_socio           as enum ('admin','consulta');

create table socios (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid unique references auth.users(id),
  nombre     text not null,
  rol        rol_socio not null default 'consulta',
  activo     boolean not null default true,
  created_at timestamptz not null default now()
);

create table clientes (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null,
  documento  text unique,
  telefono   text,
  direccion  text,
  notas      text,
  created_at timestamptz not null default now()
);

create table prestamos (
  id               uuid primary key default gen_random_uuid(),
  cliente_id       uuid not null references clientes(id),
  capital_inicial  bigint not null check (capital_inicial > 0),   -- centavos
  tasa_mensual_bp  integer not null check (tasa_mensual_bp > 0),  -- 500 = 5%
  plazo_meses      integer not null check (plazo_meses > 0),
  fecha_desembolso date not null,
  dia_pago         integer not null check (dia_pago between 1 and 31),
  metodo           metodo_amortizacion not null,
  politica_abono   politica_abono not null default 'reducir_plazo',
  estado           estado_prestamo not null default 'activo',
  created_at       timestamptz not null default now()
);

create table prestamo_socios (
  prestamo_id    uuid not null references prestamos(id) on delete cascade,
  socio_id       uuid not null references socios(id),
  tasa_bp        integer not null check (tasa_bp >= 0),   -- puntos de interés del socio
  aporte_capital bigint  not null check (aporte_capital >= 0),
  primary key (prestamo_id, socio_id)
);

create table cuotas (
  id                  uuid primary key default gen_random_uuid(),
  prestamo_id         uuid not null references prestamos(id) on delete cascade,
  version_plan        integer not null,     -- se incrementa al regenerar tras un abono
  numero              integer not null,
  fecha_vencimiento   date not null,
  saldo_inicial       bigint not null,
  capital_programado  bigint not null,
  interes_programado  bigint not null,
  cuota_total         bigint not null,
  estado              estado_cuota not null default 'pendiente',
  vigente             boolean not null default true,
  unique (prestamo_id, version_plan, numero)
);

create table pagos (
  id          uuid primary key default gen_random_uuid(),
  prestamo_id uuid not null references prestamos(id),
  fecha       date not null,
  monto       bigint not null,
  medio       text,
  nota        text,
  reversa_de  uuid references pagos(id),
  soporte_url text,                          -- comprobante en Supabase Storage
  creado_por  uuid not null references socios(id),
  created_at  timestamptz not null default now()
);

create table aplicaciones (
  id         uuid primary key default gen_random_uuid(),
  pago_id    uuid not null references pagos(id),
  cuota_id   uuid references cuotas(id),
  a_mora     bigint not null default 0,
  a_interes  bigint not null default 0,
  a_capital  bigint not null default 0
);
```

**Invariantes a hacer cumplir con constraint triggers deferidos** (no solo en el código de aplicación):

- `SUM(prestamo_socios.tasa_bp) = prestamos.tasa_mensual_bp` por préstamo
- `SUM(prestamo_socios.aporte_capital) = prestamos.capital_inicial` por préstamo
- Solo puede haber una `version_plan` vigente por préstamo

Índices: `prestamos(cliente_id)`, `cuotas(prestamo_id, vigente)`, `cuotas(fecha_vencimiento) where vigente and estado <> 'pagada'`, `pagos(prestamo_id, fecha)`.

## 5. Seguridad (RLS) — se activa desde la primera migración

`alter table ... enable row level security` en **todas** las tablas. Nada queda expuesto por defecto.

- **Helper:** función `es_socio_activo()` y `es_admin()` que resuelven contra `socios` usando `auth.uid()`, marcadas `security definer` y `stable`.
- **Lectura:** cualquier socio activo puede hacer `SELECT` de todo. Los dos socios tienen plata en todos los préstamos, así que ambos ven la cartera completa.
- **Escritura de clientes y préstamos:** solo `rol = 'admin'`.
- **`pagos` y `aplicaciones`:** política de `INSERT` solo para `admin`. **Sin políticas de `UPDATE` ni `DELETE`** — no existen, punto.
- **Storage:** bucket privado `soportes` para fotos de cédula, pagarés y comprobantes. Políticas que exijan socio activo. Nunca público.
- La Edge Function usa la `service_role` key, que salta RLS: por eso valida ella misma el rol del usuario que llama, leyendo el JWT. No expongas nunca la `service_role` key al frontend.
- Elegí la región más cercana al crear el proyecto (São Paulo). Vas a guardar cédulas y datos financieros de terceros: eso cae bajo la Ley 1581 de 2012.

## 6. Motor de cálculo (`/packages/core`) — construir primero

En este orden, cada uno con sus tests:

**6.1 `generarPlanDePagos(prestamo): Cuota[]`**

Tres métodos, todos con interés sobre saldo insoluto:

- `cuota_fija` (francesa): `cuota = P · i / (1 − (1+i)^(−n))`. Interés del período = `saldo_inicial · i`; capital = el resto. La última cuota ajusta para que el saldo cierre exacto en 0.
- `capital_fijo` (alemana): capital constante `P/n`, interés `saldo · i`, cuota decreciente.
- `solo_interes`: cuota mensual = `P · i`, capital completo en la última.

`dia_pago` en meses cortos: si es 31 y el mes tiene 30, vence el último día del mes.

**6.2 `interesCausado(saldo, tasa_bp, dias): bigint`** — base 30/360. Hace falta porque los abonos caen a mitad de período.

**6.3 `aplicarPago(estado, pago): EstadoActualizado`** — orden de imputación configurable, default: **mora → interés causado → capital**. El excedente sobre lo causado queda como abono a capital. Un pago insuficiente deja la cuota en `parcial`.

**6.4 `aplicarAbonoCapital(estado, abono, politica)`**

1. Calcular interés causado desde el último corte hasta la fecha del abono.
2. Cubrir ese interés primero; el remanente baja el capital.
3. Regenerar las cuotas restantes con `version_plan + 1`:
   - `reducir_plazo`: se mantiene la cuota, se recortan cuotas del final.
   - `reducir_cuota`: se mantiene el plazo, baja el valor de la cuota.
4. Las cuotas viejas no se borran: quedan con `vigente = false`. Quiero poder auditar cómo cambió el plan.

**6.5 `estadoPrestamo(prestamo, pagos, hoy): EstadoFinanciero`**

- saldo de capital
- interés causado no pagado
- capital e interés pagados acumulados
- cuotas pagadas, pendientes, en mora, y días de mora
- interés que falta por cobrar según el plan vigente
- total proyectado a recibir al finalizar (capital + interés)

**6.6 `repartirPorSocio(montoInteres, prestamo_socios)`**

La porción de cada socio es `interes · tasa_socio_bp / tasa_total_bp`. Con 5% repartido 1%/4%, el socio A se lleva el 20% del interés y el B el 80%. Usar `repartirProporcional` para que cuadre al peso.

**Separá dos cosas distintas:** el reparto del **interés** (ganancia, por `tasa_bp`) y la devolución del **capital** (por `aporte_capital`). No son la misma proporción y el sistema no debe asumir que lo son.

## 7. Edge Functions (escrituras)

Una función por operación, cada una envuelta en una transacción con `FOR UPDATE` sobre el préstamo:

- `crear-prestamo` — valida invariantes de socios, genera el plan v1, inserta todo
- `registrar-pago` — imputa con `aplicarPago`, inserta `pagos` + `aplicaciones`, actualiza estados de cuotas
- `registrar-abono-capital` — imputa, regenera el plan, deja el anterior como histórico
- `reversar-pago` — inserta el asiento de reverso y recalcula
- `liquidar-prepago` — cotiza y ejecuta la cancelación total

Todas devuelven el `EstadoFinanciero` actualizado. Cada una valida el rol del llamante antes de tocar nada.

Las lecturas y reportes van directo del frontend con `supabase-js` + RLS, calculando con las mismas funciones de `core`. Nada de reimplementar la plata en vistas SQL.

## 8. Reportes

- **Por préstamo:** estado financiero completo + historial de pagos + plan vigente + reparto de lo cobrado y lo proyectado entre los dos socios.
- **Consolidado:** capital colocado, capital recuperado, interés cobrado en el mes, interés por cobrar, cartera en mora, total proyectado al cierre de todos los activos.
- **Por socio:** capital aportado vivo, interés cobrado (histórico y del mes), interés proyectado pendiente, total al finalizar.
- **Agenda de cobros:** qué vence esta semana y qué está vencido, ordenado por días de mora.

## 9. UI (después de que `core` pase los tests)

Mobile-first, se usa desde el celular en la calle.

1. **Clientes** — lista con búsqueda, ficha con sus préstamos e historial.
2. **Nuevo préstamo** — preview en vivo del plan de pagos antes de guardar, con validación de que la suma de tasas de los socios da la tasa total.
3. **Detalle del préstamo** — tabla de cuotas, saldo actual, botones de pago y abono, desglose por socio.
4. **Registrar pago** — muestra qué se va a imputar a interés y qué a capital **antes** de confirmar.
5. **Dashboard** — agenda de cobros + consolidado + tarjeta por socio.

Moneda en pantalla: `$ 1.250.000` (punto de miles, sin decimales, aunque internamente sean centavos).

## 10. Cómo quiero trabajar

1. Empezá haciéndome las preguntas de la sección 11. **No escribas código hasta resolverlas.**
2. Fases, parando al final de cada una para que yo revise:
   - **F1:** monorepo + `core` con tipos y `generarPlanDePagos` + tests
   - **F2:** `aplicarPago`, `aplicarAbonoCapital`, `estadoPrestamo`, `repartirPorSocio` + tests
   - **F3:** migraciones de Supabase (schema + constraints + RLS) + seed de prueba
   - **F4:** Edge Functions + tests de integración contra Supabase local
   - **F5:** UI
3. Mostrame los tests corriendo antes de pasar de fase.
4. Si una decisión mía hace que los números queden mal, decímelo en vez de implementarla.

## 11. Decisiones a confirmar antes de empezar

1. **Método de amortización por defecto.** ¿Cuota fija, capital fijo, o solo interés con capital al final? Hay que confirmar cómo lo hace hoy el prestamista y replicarlo tal cual: si los números no cuadran contra su cuaderno, no va a usar el sistema.
2. **Efecto del abono a capital.** ¿Reduce el plazo o reduce la cuota? ¿Lo decide el cliente en cada abono o es política fija del préstamo?
3. **Interés entre fechas.** Si alguien abona el 12 y la cuota vence el 30, ¿se cobra interés proporcional por esos días o el abono solo impacta desde el siguiente corte? (Recomendación: proporcional 30/360.)
4. **Mora.** ¿Se cobra? ¿A qué tasa, sobre qué base (capital vencido o cuota vencida), desde qué día? ¿Se reparte entre los socios con la misma proporción del interés corriente?
5. **Capital de los socios.** ¿Cada socio pone plata en cada préstamo, o uno pone el capital y el otro aporta otra cosa? De esto depende si el reparto del interés y el del capital usan proporciones distintas.
6. **Prepago total.** Si cancela todo hoy, ¿se cobra solo el interés causado hasta hoy o el mes completo?
7. **Roles.** ¿El segundo socio registra pagos o solo consulta? Define las políticas de RLS.
8. **Tope de tasa.** ¿Guardamos la tasa de usura vigente para alertar cuando un préstamo la supere?

---

Este documento es la especificación viva del proyecto. Actualizalo cuando cambien las reglas de negocio.
