# SPEC — Sistema de gestión de préstamos

> Especificación viva. Reemplaza a `prompt-sistema-prestamos.md` en todo lo que contradiga.
> Última actualización: 2026-10-01 (migración de Supabase a Cloudflare: Workers + D1; sin login en esta etapa).

---

## 1. Contexto

Sistema de gestión de préstamos para un prestamista particular en Colombia. El negocio es entre **dos socios** que reparten el interés de cada préstamo en proporciones configurables préstamo por préstamo.

Maneja plata de terceros: la corrección de los cálculos y la trazabilidad importan más que la velocidad o la UI. Orden de construcción: motor de cálculo con tests → base de datos → API → UI.

Por ahora el sistema lo usa **una sola persona** (el socio administrador). El segundo socio no entra al sistema; existe como dueño de una parte del interés y del capital.

## 2. Stack

Todo corre en **Cloudflare** (se migró desde Supabase el 2026-10-01).

- **App + API:** un solo **Worker** con Workers Static Assets. Sirve la SPA y atiende `/api/*`.
- **Base de datos:** **D1** (SQLite). Fuente de verdad.
- **Frontend:** React + Vite + TypeScript + Tailwind. El plugin `@cloudflare/vite-plugin` corre el Worker y la D1 local dentro de `npm run dev`.
- **Tests:** Vitest (motor), `@cloudflare/vitest-plugin` (Worker + D1 en el runtime real) y Playwright (navegador).
- **Migraciones:** Wrangler, versionadas en `apps/web/migrations`. Nunca cambios a mano desde el dashboard.
- **Archivos (pendiente):** R2 para fotos de cédulas y comprobantes.

```
/packages/core         -> motor de cálculo, TypeScript puro, cero dependencias de runtime
/apps/web/src          -> la app (React)
/apps/web/worker       -> la API (Worker): lee D1, calcula con core, escribe el asiento
/apps/web/compartido   -> tipos del contrato entre app y API
/apps/web/migrations   -> schema de D1 versionado
/apps/web/test         -> pruebas del Worker y de la base
/apps/web/e2e          -> pruebas de navegador
```

`core` corre igual en Node (tests), en el Worker y en el navegador (vistas previas). Nada de `fetch`, DB, ni `Date.now()`: la fecha "hoy" entra siempre como parámetro.

## 3. Reglas no negociables

1. **Dinero en pesos enteros.** Todos los montos son pesos COP enteros: `INTEGER` en D1 (con tope 2^53−1 por check), `number` validado con `Number.isSafeInteger` en TypeScript. Prohibidos los fraccionarios. Las multiplicaciones intermedias que puedan pasar de 2^53 (saldo × tasa) se hacen en `BigInt` y se redondean a entero al salir.
2. **Tasas en puntos básicos.** `300` = 3.00 % mensual, `INTEGER`. Igual para la parte de cada socio.
3. **El redondeo cuadra siempre.** `repartirProporcional(total, pesos[])` — la última parte con peso > 0 absorbe el residuo; test de `sum(resultado) === total` sobre miles de casos aleatorios.
4. **Fechas calendario.** Desembolsos, cortes y pagos son texto `YYYY-MM-DD` (validado por check en D1). Nunca `new Date()` para aritmética de negocio. Los `created_at` de auditoría son marcas de tiempo UTC. Zona de referencia: `America/Bogota`.
5. **El libro contable es inmutable.** `pagos`, `aplicaciones` y `reparto_socios` tienen triggers que rechazan `UPDATE` y `DELETE`. Corregir = insertar un reverso que apunta al original (`reversa_de`).
6. **Todo movimiento de plata es atómico y serializado por préstamo.** Leer el libro → calcular con `core` → escribir el asiento completo en un `batch` de D1 (una transacción). D1 no tiene bloqueo de filas: la serialización la da el consecutivo `pagos.numero` (ver §6).
7. **Cero lógica financiera en SQL.** Los cálculos viven solo en `core`. D1 guarda, valida invariantes y controla acceso.
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
| 7 | Usuarios | **Sin login en esta etapa** (decisión del 2026-10-01): la app queda disponible directamente. El login se agrega más adelante en un único punto (`worker/acceso.ts`). |
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
3. El sobrante, según lo que se elija al registrar el pago (`sobrante`):
   - `capital` (por defecto): baja la deuda. Si excede el saldo → error (el cliente pagaría de más).
   - `adelantar`: paga primero el interés del **próximo mes — uno solo**, el primero que todavía no esté pagado — y lo que quede baja la deuda. Ej.: al día, próximo interés 25.000, entrega 150.000 → 25.000 al mes siguiente y 125.000 a capital. Para adelantar otro mes se registra otro pago (mes a mes). Si no alcanza para el mes entero, queda pagado en parte. Con plazo no se adelanta más allá del plazo.

El capital abonado reduce el interés a partir del período `k+1`.

**Mes adelantado y abonos.** Un mes nunca vale menos que lo ya pagado por él: el mes adelantado se cobra sobre el saldo de antes del pago y queda como está aunque ese mismo pago, o uno posterior, abone a capital; el abono baja el interés desde el primer mes sin pagar. No se devuelve interés (tampoco al cancelar todo). El estado salta los meses adelantados: `proximoCorte` es el primer corte futuro que aún debe algo e `interesPagadoHasta` indica hasta qué corte está cubierto.

Reglas adicionales:
- Un pago hecho el mismo día de un corte paga ese mes (ya vencido); no adelanta el mes siguiente: el sobrante va a capital.
- Los pagos se registran en orden: la fecha de un pago nuevo no puede ser anterior al último movimiento efectivo, ni posterior a hoy.
- Ningún pago se acepta sobre un préstamo cancelado.
- **Reparto de cada imputación:** el interés se reparte por `tasa_bp` (la última parte con peso absorbe el residuo); el capital se reparte en proporción a lo que aún se le debe a cada socio (`aporte − devuelto`, método del mayor residuo). Así nadie recibe más que su aporte y al cancelar cada socio recupera su aporte exacto al peso.

### 5.4 Cancelación total (fecha `f`, período en curso `k`)

El Worker recibe el total que se le mostró al usuario; si el cálculo dio otra cifra, rechaza (`COTIZACION_DESACTUALIZADA`). Después de liquidar, el interés del período `k` queda fijado en lo cobrado y los períodos siguientes no generan interés.

`vencidos_no_pagados + max(0, proporcional_k − ya_pagado_k) + saldo`, con
`proporcional_k = redondear(saldo_k · tasa_bp · dias / (10000 · 30))`, `dias = min(30, dias30E360(corte(k-1), f))`, y `dias = 30` si `f = corte(k)`. Si el interés del período ya se había pagado completo por adelantado, no se devuelve la diferencia.

### 5.5 Reversos

Solo se puede reversar el **último** movimiento no reversado del préstamo (LIFO). Así la imputación de los movimientos posteriores nunca queda inconsistente. El reverso lleva `monto` negativo y aplicaciones espejo negativas.

## 6. Schema (D1 / SQLite)

Definido en `apps/web/migrations`. Tablas `STRICT` (SQLite rechaza valores de otro tipo):

- `socios` — dueños de la plata.
- `clientes` — `documento` único.
- `prestamos` — capital, tasa, fecha de desembolso, plazo opcional, `vehiculo` y `placa` (garantía; se pueden corregir siempre), `estado` (`activo`/`pagado`/`castigado`; el atraso se calcula, no se guarda).
- `prestamo_socios` — parte de la tasa y del capital de cada socio.
- `pagos` — el libro: `tipo` (`pago`/`liquidacion`/`reverso`), `monto` (negativo en reversos), `reversa_de` único, y **`numero`**: consecutivo del movimiento dentro del préstamo.
- `aplicaciones` — cómo se imputó cada pago (interés por período, o capital).
- `reparto_socios` — cuánto de cada aplicación le tocó a cada socio (congelado para auditoría).
- `prestamos_verificados` / `pagos_verificados` — filas de cierre (ver abajo).

**Lo que la base hace cumplir por sí misma (triggers y checks):**

- **Libro inmutable:** `UPDATE` y `DELETE` sobre `pagos`, `aplicaciones` y `reparto_socios` se rechazan siempre.
- **Condiciones congeladas:** con el primer pago ya no se pueden cambiar capital, tasa, fechas, plazo, cliente ni socios del préstamo. El estado y las notas sí.
- **Reversos:** mismo préstamo, monto exacto negado, no se reversa un reverso, y un pago se reversa una sola vez.
- **Consecutivo sin huecos:** `pagos.numero` debe ser exactamente el siguiente del préstamo (`unique` + trigger).
- **Sumas de control al cierre:** SQLite no tiene constraints diferidos, así que el Worker inserta una fila de cierre al final de cada transacción y su trigger verifica el conjunto: las tasas y aportes de los socios suman los del préstamo; las aplicaciones suman el monto del pago; el reparto suma cada aplicación, con signos coherentes y solo socios del préstamo. Si algo no cuadra, se revierte toda la transacción.

**Eliminación lógica de clientes.** `clientes.eliminado_en` (fecha y hora, o null). "Eliminar" un cliente solo pone esa marca: él, sus préstamos y sus pagos dejan de existir para la app porque el Worker filtra todas las lecturas (`CLIENTE_VIGENTE` / `PRESTAMO_VIGENTE` en `worker/repo.ts`), y por lo tanto también las operaciones (pagar, liquidar o reversar un préstamo oculto da 404) y los reportes. Nada se borra y el libro sigue intacto; se revierte con "Restaurar". La cédula de un cliente eliminado sigue ocupada: crear otro con la misma devuelve un error que indica restaurarlo.

**Triggers: `BEGIN` y `END` en MAYÚSCULAS.** La API de consultas de D1, que es la que usa `wrangler d1 migrations apply --remote`, solo así reconoce el cuerpo de un trigger; en minúsculas lo corta en el primer `;` y falla con `incomplete input`. La base local los acepta en minúsculas, así que el error solo aparece en producción (por esto la migración 0002 estuvo sin aplicar hasta el 2026-10-01). Hay un test que lo vigila.

**Concurrencia (reemplazo de `FOR UPDATE`).** Dos operaciones simultáneas sobre un préstamo leen N movimientos y ambas calculan el número N+1. La primera entra; la segunda choca, se descarta entera, y el Worker la reintenta leyendo el libro ya actualizado (hasta 3 veces). Hay una prueba que mete un pago justo entre la lectura y la escritura del Worker: sin el consecutivo, esa prueba falla con un doble cobro del mismo mes.

Límite conocido frente a Postgres: la fila de cierre la inserta el Worker; alguien que escriba directo en D1 podría omitirla. Las demás invariantes se cumplen aunque se escriba por fuera de la app.

## 7. Seguridad

- **Sin login en esta etapa.** Cualquiera que llegue a la dirección de la app puede ver y registrar movimientos. Aceptable solo en local o mientras la dirección no se comparta. **Antes de publicarla hay que decidir**: abierta, clave compartida, login con Google o Cloudflare Access.
- **Un solo punto de control:** toda petición a `/api/*` pasa por `autorizar()` en `worker/acceso.ts`, que hoy devuelve rol admin. Agregar login es cambiar esa función; el resto del Worker ya distingue lectura (`GET`) de escritura (exige admin). En la app, `useSesion()` es el punto equivalente.
- La base **no es accesible desde el navegador**: solo el Worker tiene el binding de D1. No hay claves de base de datos en el frontend.
- Todo valor externo se valida (`worker/entrada.ts`) y se enlaza como parámetro; nunca se interpola en SQL.
- No hay identidad del usuario todavía, así que los pagos no guardan quién los registró.
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

## 9. API (`apps/web/worker`)

| Método y ruta | Qué hace |
|---|---|
| `GET /api/socios` · `POST` · `PATCH /:id` | Lista, crea, renombra o activa/desactiva socios |
| `GET /api/clientes` · `GET /:id` · `POST` · `PATCH /:id` | Clientes vigentes |
| `DELETE /api/clientes/:id` · `POST /:id/restaurar` · `GET /api/clientes?eliminados=1` | Eliminación lógica, restauración y lista de eliminados |
| `GET /api/prestamos[?clienteId=]` · `GET /:id` | Préstamos con su libro completo (pagos → aplicaciones → reparto) |
| `POST /api/prestamos` | Crea el préstamo con sus socios (y vehículo/placa); devuelve plan y estado |
| `PATCH /api/prestamos/:id` | Corrige vehículo, placa y notas (no las condiciones) |
| `POST /api/prestamos/:id/pagos` | Imputa con `aplicarPago` y guarda el asiento. `simular: true` no guarda |
| `POST /api/prestamos/:id/liquidacion` | `simular: true` cotiza; para ejecutar exige `montoCotizado`. Marca `pagado` |
| `POST /api/prestamos/:id/reversos` | Reversa el último movimiento; si reabre un préstamo pagado, vuelve a `activo` |

- **"Hoy"** se calcula en `America/Bogota` en el Worker y entra a `core` como parámetro.
- **Errores** (`{ error: { codigo, mensaje } }`): `400 ENTRADA_INVALIDA`, `404`, `422 <código de core>`, `409 CONFLICTO` (se agotaron los reintentos), `409 INVARIANTE_VIOLADA` (la base rechazó algo que core dejó pasar: es un bug), `500`.
- El estado de cada préstamo no se guarda: la app lo calcula con `core` a partir del libro que devuelve la API.

## 10. Reportes

- **Por préstamo:** estado financiero + historial de pagos + proyección + reparto por socio de lo cobrado y lo proyectado.
- **Consolidado:** capital colocado, capital recuperado, interés cobrado en el mes, interés del mes por cobrar, cartera atrasada.
- **Por socio:** capital aportado vivo, interés cobrado (histórico y del mes), interés mensual esperado.
- **Agenda de cobros:** qué corta esta semana y qué está atrasado, ordenado por días de atraso.

## 11. UI

Mobile-first (`apps/web/src`). Pantallas: Inicio (atrasados, cortes de la semana, cartera, tarjeta por socio) · Clientes (búsqueda, alta, edición) · Préstamos (filtros) · Nuevo préstamo (plan en vivo, suma de tasas y aportes de socios) · Detalle (saldo, vencido, próximo corte, socios, pagos, meses) · Registrar pago y Cancelar todo (imputación calculada con core antes de confirmar) · Cuenta (socios).

Moneda: `$ 1.250.000`. Donde haya cuota redondeada se muestra al lado la exacta, ej. **$ 38.000** (exacta $ 37.037).

**Gráficas** (`src/ui/graficas.tsx`, SVG/HTML propios, sin librerías): cifra principal, columnas de interés cobrado por mes (se toca un mes para ver su valor), medidor del cobro del mes, barras partidas de cartera al día/atrasada y de capital por socio, y una tira con un cuadrito por mes en el detalle del préstamo. Reglas: el color nunca es el único canal (siempre hay texto o símbolo: verde y rojo no se distinguen con daltonismo), los valores exactos se ven sin tooltip, y cada gráfica tiene su equivalente en texto. La paleta se validó con el script de la guía de visualización sobre el blanco de las tarjetas.

**Cargar préstamos que ya venían corriendo.** Se crea el préstamo con la fecha real de entrega y se registran los pagos ya hechos, del más viejo al más nuevo. La pantalla de pago tiene un modo "pagos pasados" que propone el corte más antiguo sin pagar con su cuota, y "Guardar y registrar otro" para cargar varios seguidos. Límites: los pagos van en orden de fecha y cada uno debe cubrir al menos el interés vencido a su fecha.

**Informe para el socio** (`/informe`, desde Inicio). Genera el Excel `PAGOS <MES> <AÑO>.xlsx` con la misma estructura de la hoja que se llevaba a mano: columnas A–L (n.º, CLIENTE, VEHICULO, PLACA, PRESTAMO, ABONO A CAP, SALDO, FECHA DE PAGO, TASA INTERES, TOTAL INTERES, <SOCIO>, %), una fila por préstamo activo en el orden en que se registraron, fila TOTAL con la suma de saldos y recuadro de OBSERVACIONES. Se elige el socio del informe y se escriben las observaciones. `ABONO A CAP` lista cada abono a capital; `FECHA DE PAGO` es el próximo corte; `TOTAL INTERES` es un mes de interés sobre el saldo de hoy y la columna del socio su parte. Datos en `src/datos/informeSocio.ts` (con tests), dibujo en `src/lib/excelInformeSocio.ts` (ExcelJS, bajo demanda).

**Estado de cuenta en PDF** (botón en el detalle del préstamo). Documento para el **cliente**: capital que debe hoy, capital abonado, interés pagado, interés atrasado, próximo pago, cuánto cuesta cancelar todo hoy, cada pago con su reparto entre interés y capital y el capital que quedó, y el mes a mes. **No incluye el reparto entre socios** (es interno) ni los pagos reversados. Los datos los arma `src/datos/estadoCuenta.ts` a partir de core (con tests); `src/lib/pdfEstadoCuenta.ts` solo los dibuja con jsPDF, que se carga bajo demanda. Va en dos pasos — generar y luego Compartir/Descargar — porque Safari solo deja abrir el menú de compartir como respuesta directa a un toque.

Pendiente: login, y subir soportes (fotos de cédula y comprobantes) a R2.

## 12. Comandos

Desde la raíz del repo:

| Comando | Qué hace |
|---|---|
| `npm run dev` | App + API + D1 local en http://127.0.0.1:5173 |
| `npm run db:migrar` | Aplica las migraciones a la D1 local |
| `npm test` | Motor (90) + Worker y base (20) |
| `npm run test:e2e` | Navegador (Edge) contra una base vacía propia |
| `npm run typecheck` | Tipos de la app, el Worker y el motor |
| `npm run db:migrar:remoto -w @prestamos/web` | Aplica las migraciones a la D1 de producción. **Va antes de subir código que dependa de una migración nueva**: el push a `main` publica solo y no migra |
| `npm run deploy` | Compila y publica en Cloudflare (requiere `wrangler login` y haber decidido el acceso, §7) |

Reinicio de producción: el 2026-10-01 se vació la base (los datos eran de prueba) y se aplicaron las 4 migraciones; hay un respaldo previo en `docs/respaldos/` (carpeta fuera de git, igual que el Excel de referencia).

Historia: F1–F2 motor · F3–F5 sobre Supabase (Postgres, Edge Functions, RLS) · migración a Cloudflare el 2026-10-01. El código de Supabase está en el historial de git hasta el commit `8fe3935`.

