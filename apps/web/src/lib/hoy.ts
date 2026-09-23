/** Fecha de hoy en Colombia, 'YYYY-MM-DD'. Es la misma regla que usan las Edge Functions. */
export function hoyBogota(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
