-- Eliminación lógica de clientes: no se borra nada. Un cliente con
-- `eliminado_en` deja de aparecer en la app junto con sus préstamos y pagos
-- (el Worker los filtra en todas las lecturas), y se puede restaurar.
-- El libro contable sigue intacto e inmutable.
alter table clientes add column eliminado_en text;

create index clientes_eliminado_idx on clientes (eliminado_en);
