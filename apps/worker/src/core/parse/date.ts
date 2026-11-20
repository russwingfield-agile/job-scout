const UK_DATE = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;

/**
 * Reed dates ("31/07/2025", day first) or ISO-8601 → ISO UTC string, or null if unreadable.
 * UK dates are taken as midnight UTC; round-tripping rejects impossible dates like 31/02/2025.
 */
export function parseSourceDate(value: string | null | undefined): string | null {
  const s = (value ?? '').trim();

  const uk = UK_DATE.exec(s);
  if (uk) {
    const [day, month, year] = [Number(uk[1]), Number(uk[2]), Number(uk[3])];
    const d = new Date(Date.UTC(year, month - 1, day));
    const valid = d.getUTCDate() === day && d.getUTCMonth() === month - 1;
    return valid ? d.toISOString() : null;
  }

  if (ISO_DATE.test(s)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}
