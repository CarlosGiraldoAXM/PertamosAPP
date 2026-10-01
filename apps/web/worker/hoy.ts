/** Fecha de hoy en Colombia (America/Bogota), como 'YYYY-MM-DD'. */
export function hoyBogota(): string {
  // en-CA formatea como YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
