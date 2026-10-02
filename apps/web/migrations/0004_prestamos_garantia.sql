-- Garantía del préstamo, como se lleva en el informe mensual para el socio.
-- Son datos descriptivos: se pueden corregir aunque el préstamo ya tenga pagos
-- (no están entre las condiciones que congela el trigger de 0002).
alter table prestamos add column vehiculo text;
alter table prestamos add column placa text;
