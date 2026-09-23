# SPEC — Sistema de gestión de préstamos

> Especificación viva. Reemplaza a `prompt-sistema-prestamos.md` en todo lo que contradiga.
> Última actualización: 2026-09-22 (decisiones de negocio confirmadas, schema revisado).

---

## 1. Contexto

Sistema de gestión de préstamos para un prestamista particular en Colombia. El negocio es entre **dos socios** que reparten el interés de cada préstamo en proporciones configurables préstamo por préstamo.

Maneja plata de terceros: la corrección de los cálculos y la trazabilidad importan más que la velocidad o la UI. Orden de construcción: motor de cálculo con tests → base de datos → API → UI.

Por ahora el sistema lo usa **una sola persona** (el socio administrador). El segundo socio no entra al sistema; existe como dueño de una parte del interés y del capital.

## 2. Stack

- **Base de datos:** Supabase (Postgres) — fuente de verdad, incluyendo Auth, RLS y Storage. Región São Paulo.
- **Backend:** Supabase Edge Functions (Deno) para toda operación que mueve plata.
- **Frontend:** React + Vite + TypeScript + Tailwind, desplegado en Cloudflare Pages.
- **Cliente de datos:** `supabase-js` para lecturas (protegidas por RLS); las escrituras de dinero van por Edge Function.
- **Driver en Edge Functions:** `postgres.js` por Supavisor en **session mode** (transacciones interactivas reales).
- **Tests:** Vitest.
- **Migraciones:** Supabase CLI, versionadas en `/supabase/migrations`. Nunca cambios a mano desde el dashboard.

```
/packages/core        -> motor de cálculo, TypeScript puro, cero dependencias de runtime
/supabase/migrations  -> schema versionado
/supabase/functions   -> Edge Functions (importan /packages/core)
/apps/web             -> React + Vite
```

`core` corre igual en Node (tests), Deno (Edge Functions) y browser (previews). Nada de `fetch`, DB, ni `Date.now()`: la fecha "hoy" entra siempre como parámetro. Los imports relativos llevan extensión `.ts` para que Deno los resuelva sin build.

## 3. Reglas no negociables

1. **Dinero en pesos enteros.** Todos los montos son pesos COP enteros: `BIGINT` en Postgres, `number` validado con `Number.isSafeInteger` en TypeScript. Prohibidos los fraccionarios. Las multiplicaciones intermedias que puedan pasar de 2^53 (saldo × tasa) se hacen en `BigInt` y se redondean a entero al salir.
2. **Tasas en puntos básicos.** `300` = 3.00 % mensual, `INTEGER`. Igual para la parte de cada socio.
3. **El redondeo cuadra siempre.** `repartirProporcional(total, pesos[])` — la última parte con peso > 0 absorbe el residuo; test de `sum(resultado) === total` sobre miles de casos aleatorios.
4. **Fechas calendario.** Desembolsos, cortes y pagos son `DATE` en Postgres y `YYYY-MM-DD` en TypeScript. Nunca `new Date()` para aritmética de negocio. Los `created_at` de auditoría son `TIMESTAMPTZ`. Zona de referencia: `America/Bogota`.
5. **El libro contable es inmutable.** `pagos`, `aplicaciones` y `reparto_socios` no tienen políticas de `UPDATE` ni `DELETE`. Corregir = insertar un reverso que apunta al original (`reversa_de`).
6. **Todo movimiento de plata pasa por una transacción con bloqueo.** `BEGIN` → `SELECT … FROM prestamos WHERE id = $1 FOR UPDATE` → leer movimientos → calcular con `core` → insertar → `COMMIT`.
7. **Cero lógica financiera en SQL.** Los cálculos viven solo en `core`. Postgres guarda, valida invariantes y controla acceso.
8. **Tests antes de la UI.** Cada función de `core` va con sus tests desde el primer commit.

## 4. Reglas de negocio (confirmadas)

| # | Tema | Decisión |
|---|------|----------|
| 1 | Método | **Solo interés.** Cada mes se cobra el interés sobre el saldo; el capital se devuelve cuando el cliente pueda (total o en abonos). No hay cuota fija de capital. |
| 2 | Abonos | Todo lo que exceda el interés baja la deuda. El capital menor genera menos interés **desde el corte siguiente**. |
| 3 | Pago antes del corte | Cubre el interés del **mes completo** (no se prorratea). |
| 4 | Mora | **No hay mora** por ahora. Un mes sin pagar solo acumula interés corriente vencido y se reporta como atraso. |
| 5 | Socios | Cada préstamo define cuánto de la tasa es de cada socio (ej. 3 % = 1 % socio A + 2 % socio B) y cuánto capital puso cada uno. Interés se reparte por `tasa_bp`; capital devuelto por `aporte_capital`. Son proporciones independientes. |
| 6 | Cancelación total | Se cobra el interés **proporcional hasta el día del pago** (30/360). Es la única excepción al "mes completo". |
| 7 | Usuarios | Un usuario administrador con correo + clave inicial (debe cambiarla al entrar) y opción de vincular una cuenta Google. El segundo socio no tiene usuario. |
| 8 | Usura | No se controla. |
| 9 | Fechas de corte | El mes cuenta desde el desembolso; el corte es el mismo día de cada mes siguiente. Si ese día no existe (31 en un mes de 30), vence el último día del mes. |
| 10 | Redondeo | La cuota a cobrar se redondea **hacia arriba a los mil**. La UI muestra siempre la cuota exacta al lado. El excedente del redondeo se imputa como **abono a capital**. |
| 11 | Unidad | Pesos enteros, sin centavos. |
| 12 | Pago mínimo | Se asume que el pago siempre cubre al menos el interés vencido. Si no, el sistema **rechaza** el pago (no inventa una regla). |

## 5. Modelo de cálculo

### 5.1 Cortes y períodos

- `corte(0) = fecha_desembolso`.
- `corte(k)` = día del desembolso en el mes `desembolso + k`, limitado al último día del mes. Se calcula siempre desde el desembolso (no encadenado): desembolso 31-ene → 28-feb → 31-mar.
- Período `k` = `(corte(k-1), corte(k)]`. Un pago hecho exactamente el día de corte pertenece al período que vence ese día.

### 5.2 Interés del período

- `saldo_k` = capital pendiente al final del día `corte(k-1)` (después de aplicar todos los movimientos con fecha ≤ `corte(k-1)`). Excepción: `saldo_1` es siempre el capital inicial (un pago el día del desembolso pertenece al período 1 y su abono baja el interés desde el período 2).
- `interes_k = redondear(saldo_k · tasa_bp / 10000)` — redondeo al peso, mitad hacia arriba.
- Cuota a cobrar del período = `techoMil(interes_pendiente_k)`, pero nunca más que interés + saldo.

### 5.3 Imputación de un pago (fecha `f`, período en curso `k`)

1. Interés de períodos **vencidos** no pagados (`corte(j) ≤ f`), del más antiguo al más nuevo. Si el pago no alcanza → error.
2. Interés del período en curso `k` completo (regla "mes completo"). Si no alcanza, queda parcial.
3. El resto a capital. Si excede el saldo → error (el cliente pagaría de más).

El capital abonado reduce el interés a partir del período `k+1`.

Reglas adicionales:
- Un pago hecho el mismo día de un corte paga ese mes (ya vencido); no adelanta el mes siguiente: el sobrante va a capital.
- Los pagos se registran en orden: la fecha de un pago nuevo no puede ser anterior al último movimiento efectivo, ni posterior a hoy.
- Ningún pago se acepta sobre un préstamo cancelado.
- **Reparto de cada imputación:** el interés se reparte por `tasa_bp` (la última parte con peso absorbe el residuo); el capital se reparte en proporción a lo que aún se le debe a cada socio (`aporte − devuelto`, método del mayor residuo). Así nadie recibe más que su aporte y al cancelar cada socio recupera su aporte exacto al peso.

### 5.4 Cancelación total (fecha `f`, período en curso `k`)

La Edge Function recibe el total que se le mostró al usuario; si el cálculo dio otra cifra, rechaza (`COTIZACION_DESACTUALIZADA`). Después de liquidar, el interés del período `k` queda fijado en lo cobrado y los períodos siguientes no generan interés.

`vencidos_no_pagados + max(0, proporcional_k − ya_pagado_k) + saldo`, con
`proporcional_k = redondear(saldo_k · tasa_bp · dias / (10000 · 30))`, `dias = min(30, dias30E360(corte(k-1), f))`, y `dias = 30` si `f = corte(k)`. Si el interés del período ya se había pagado completo por adelantado, no se devuelve la diferencia.

### 5.5 Reversos

Solo se puede reversar el **último** movimiento no reversado del préstamo (LIFO). Así la imputación de los movimientos posteriores nunca queda inconsistente. El reverso lleva `monto` negativo y aplicaciones espejo negativas.

## 6. Schema (Postgres)

```sql
create type estado_prestamo as enum ('activo','pagado','castigado');  -- atraso se calcula, no se guarda
create type rol_usuario     as enum ('admin','consulta');
create type tipo_pago       as enum ('pago','liquidacion','reverso');

-- Quién entra al sistema. La clave vive en auth.users (hash), nunca aquí.
create table usuarios (
  id                 uuid primary key references auth.users(id) on delete cascade,
  email              text not null unique,
  email_google       text unique,              -- cuenta Google vinculada (informativo; el vínculo real es auth.identities)
  nombre             text not null,
  rol                rol_usuario not null default 'consulta',
  activo             boolean not null default true,
  debe_cambiar_clave boolean not null default true,
  created_at         timestamptz not null default now()
);

-- Dueños de la plata. Un socio puede no tener usuario.
create table socios (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null,
  usuario_id uuid unique references usuarios(id),
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
  capital_inicial  bigint  not null check (capital_inicial > 0),
  tasa_mensual_bp  integer not null check (tasa_mensual_bp > 0),
  fecha_desembolso date    not null,
  plazo_meses      integer check (plazo_meses > 0),   -- null = capital "cuando pueda"
  estado           estado_prestamo not null default 'activo',
  notas            text,
  creado_por       uuid not null references usuarios(id),
  created_at       timestamptz not null default now()
);

create table prestamo_socios (
  prestamo_id    uuid not null references prestamos(id),
  socio_id       uuid not null references socios(id),
  tasa_bp        integer not null check (tasa_bp >= 0),
  aporte_capital bigint  not null check (aporte_capital >= 0),
  primary key (prestamo_id, socio_id)
);

create table pagos (
  id           uuid primary key default gen_random_uuid(),
  prestamo_id  uuid not null references prestamos(id),
  tipo         tipo_pago not null,
  fecha        date not null,
  monto        bigint not null,
  medio        text,
  nota         text,
  reversa_de   uuid unique references pagos(id),   -- unique: un pago se reversa una sola vez
  soporte_path text,                               -- ruta en el bucket privado `soportes`
  creado_por   uuid not null references usuarios(id),
  created_at   timestamptz not null default now(),
  check ((tipo = 'reverso') = (reversa_de is not null)),
  check ((tipo = 'reverso' and monto < 0) or (tipo <> 'reverso' and monto > 0))
);

-- Cómo se imputó cada pago. periodo = número de corte para interés; null para capital.
create table aplicaciones (
  id        uuid primary key default gen_random_uuid(),
  pago_id   uuid not null references pagos(id),
  periodo   integer check (periodo > 0),
  a_interes bigint not null default 0,
  a_capital bigint not null default 0,
  check ((periodo is not null and a_capital = 0) or (periodo is null and a_interes = 0))
);

-- Reparto de cada aplicación entre socios (calculado por core, guardado para auditoría).
create table reparto_socios (
  aplicacion_id uuid not null references aplicaciones(id),
  socio_id      uuid not null references socios(id),
  interes       bigint not null default 0,
  capital       bigint not null default 0,
  primary key (aplicacion_id, socio_id)
);
```

Cambios frente al borrador original y por qué:

- **Se eliminó la tabla `cuotas`** (y `version_plan`, `metodo`, `politica_abono`, `dia_pago`). Con solo interés y capital libre, el "plan" es una proyección que `core` deriva de las condiciones + los pagos. Guardarlo duplicaba cálculo en la base (viola regla 7) y obligaba a versionarlo en cada abono.
- **`en_mora` / `vencida` no se guardan:** dependen de "hoy" y quedarían desactualizados. Se calculan con `estadoPrestamo(…, hoy)`.
- **`usuarios` separado de `socios`:** quien entra al sistema no es lo mismo que quien pone plata.
- **`pagos.tipo`**, `reversa_de unique` y checks de signo: un reverso no puede duplicarse y el signo del monto es coherente.
- **`reparto_socios`:** deja congelado cuánto le tocó a cada socio de cada pago.
- **`soporte_path`** en vez de URL: el bucket es privado; la UI pide URLs firmadas temporales.

**Invariantes (constraint triggers `deferrable initially deferred`):**
QUE DEBO HACER PARA LA BASE DE DATOS DE SUPABASE??, 
- `SUM(prestamo_socios.tasa_bp) = prestamos.tasa_mensual_bp` por préstamo.
- `SUM(prestamo_socios.aporte_capital) = prestamos.capital_inicial` por préstamo.
- `prestamo_socios` no se modifica si el préstamo ya tiene pagos.
- Un reverso no puede reversar otro reverso y debe ser del mismo préstamo y por el monto exacto negado.
- Por cada pago, `SUM(a_interes + a_capital) = monto`; por cada aplicación, la suma de `reparto_socios` cuadra con ella.

**Inmutabilidad a nivel base:** además de no tener políticas RLS de escritura, `pagos`, `aplicaciones` y `reparto_socios` tienen triggers que rechazan `UPDATE`, `DELETE` y `TRUNCATE` para cualquier rol (incluida la conexión privilegiada de las Edge Functions). Las condiciones de un préstamo (capital, tasa, fechas, plazo, cliente) y sus socios se congelan en cuanto tiene un pago; el estado y las notas sí se pueden cambiar.

**Índices:** `prestamos(cliente_id)`, `prestamos(estado)`, `pagos(prestamo_id, fecha)`, `aplicaciones(pago_id)`.

## 7. Seguridad

- RLS activada en **todas** las tablas desde la primera migración.
- Helpers `es_usuario_activo()` y `es_admin()` (`security definer`, `stable`, `search_path` fijo) contra `usuarios` con `auth.uid()`.
- **Lectura:** cualquier usuario activo lee todo.
- **Escritura de `clientes`:** solo admin, vía `supabase-js`.
- **`prestamos`, `prestamo_socios`, `pagos`, `aplicaciones`, `reparto_socios`:** **sin políticas de escritura para `authenticated`.** Solo las Edge Functions escriben (conexión privilegiada). Sin `UPDATE`/`DELETE` en el libro contable, punto.
- **Auth:** registro público **desactivado**. El admin se crea por script de seed con `ADMIN_EMAIL` y `ADMIN_CLAVE_INICIAL` desde variables de entorno (nunca en el repo) y `debe_cambiar_clave = true`. Google se vincula desde la sesión ya iniciada (`linkIdentity`, manual linking activado). Un login Google no vinculado no tiene fila en `usuarios` → RLS no le deja ver nada.
- **Storage:** bucket privado `soportes` (cédulas, pagarés, comprobantes); políticas que exigen usuario activo.
- Las Edge Functions validan el JWT y el rol del llamante antes de tocar nada. La `service_role` key nunca llega al frontend.
- Datos de terceros bajo Ley 1581 de 2012.

## 8. Motor de cálculo (`/packages/core`)

**F1**
- `fechas`: validar/parsear `YYYY-MM-DD`, días del mes, `fechaCorte(desembolso, k)`, `dias30E360(a, b)`, `periodoDeFecha(desembolso, f)`.
- `dinero`: `assertPesos`, `repartirProporcional`, `techoMil`, `interesMensual(saldo, bp)`, `interesProporcional(saldo, bp, dias)`.
- `generarPlanDePagos(condiciones, opciones)`: proyección de cortes suponiendo que el cliente paga la cuota redondeada; el excedente del redondeo baja el saldo. Con `plazo_meses` el último corte incluye todo el capital; sin plazo se proyecta un horizonte (12 meses por defecto).

**F2** (todas reciben el préstamo con sus socios y los movimientos guardados, en orden de registro; devuelven el asiento listo para insertar)
- `validarPrestamo` — sumas de tasas y aportes de socios.
- `analizarLibro` / `validarMovimientos` — reconstruye saldos desde el libro y detecta inconsistencias (`LIBRO_INCONSISTENTE`).
- `aplicarPago(prestamo, movimientos, pago, hoy)` — imputación §5.3.
- `cotizarLiquidacion` / `aplicarLiquidacion` — §5.4.
- `reversarPago` — §5.5.
- `estadoPrestamo(prestamo, movimientos, hoy)`: saldo de capital, interés vencido no pagado, períodos y días de atraso, lo que se cobra hoy y el próximo corte (exacto y redondeado), capital e interés pagados, proyección, total al finalizar (si hay plazo), y por socio: interés cobrado, capital devuelto y pendiente, interés vencido y proyectado.
- `repartirInteres` / `repartirCapital` — reparto entre socios (§5.3).

## 9. Edge Functions

Una por operación, cada una en transacción con `FOR UPDATE` sobre el préstamo, devolviendo el `EstadoFinanciero` actualizado:

- `crear-prestamo` — valida socios (sumas), inserta préstamo + socios.
- `registrar-pago` — imputa con `aplicarPago`, inserta `pagos` + `aplicaciones` + `reparto_socios`.
- `liquidar-prestamo` — cotiza y ejecuta la cancelación total; marca `pagado`.
- `reversar-pago` — solo el último movimiento; inserta el reverso espejo.

## 10. Reportes

- **Por préstamo:** estado financiero + historial de pagos + proyección + reparto por socio de lo cobrado y lo proyectado.
- **Consolidado:** capital colocado, capital recuperado, interés cobrado en el mes, interés del mes por cobrar, cartera atrasada.
- **Por socio:** capital aportado vivo, interés cobrado (histórico y del mes), interés mensual esperado.
- **Agenda de cobros:** qué corta esta semana y qué está atrasado, ordenado por días de atraso.

## 11. UI

Mobile-first. Clientes · Nuevo préstamo (preview en vivo + validación de la suma de tasas de socios) · Detalle del préstamo · Registrar pago (muestra la imputación antes de confirmar) · Dashboard.

Moneda: `$ 1.250.000`. Donde haya cuota redondeada se muestra al lado la exacta, ej. **$ 38.000** (exacta $ 37.037).

## 12. Fases

- **F1:** monorepo + `core` (fechas, dinero, `generarPlanDePagos`) + tests
- **F2:** `aplicarPago`, `cotizarLiquidacion`, `estadoPrestamo`, `repartirPorSocio` + tests
- **F3:** migraciones (schema + constraints + RLS) + seed
- **F4:** Edge Functions + tests de integración contra Supabase local
- **F5:** UI

Cada fase termina mostrando los tests corriendo y espera revisión.
