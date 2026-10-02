-- Préstamos traídos del registro anterior (la hoja de Excel) como saldo de
-- apertura: en el sistema arrancan con el saldo del día en que se cargaron, y
-- acá queda, solo como referencia para los informes, cuánto se prestó
-- originalmente y qué abonos a capital se habían hecho antes.
-- Null en los préstamos creados directamente en el sistema.
alter table prestamos add column origen_capital integer check (origen_capital is null or origen_capital > 0);
alter table prestamos add column origen_abonos text; -- JSON: lista de abonos anteriores, ej. [4000000, 750000]
