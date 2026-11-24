/**
 * Timestamp parsing helpers.
 *
 * GitHub returns ISO-8601 strings (or `null` for never-pushed repositories).
 * Invalid or missing values must never silently sort as "very old" or "now";
 * callers treat `null` as "no date" and push those rows to the end.
 */

/** Parses an API timestamp into epoch milliseconds, or `null` when unusable. */
export function parseTimestamp(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const ms = Date.parse(trimmed);
  if (!Number.isFinite(ms)) return null;
  return ms;
}

/** Returns the ISO representation for a valid epoch millisecond value. */
export function toIsoString(ms: number): string {
  return new Date(ms).toISOString();
}
