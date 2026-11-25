/**
 * The limits the server holds a field to (`limits` of `GET /bootstrap`: lengths in characters, one figure in minor units), read from its own
 * constraints, so a form checks what the server will check. A limit the answer does not carry (an older server) is the built-in fallback.
 */
export type Limits = Readonly<Record<string, Readonly<Record<string, number>>>>;

export const NO_LIMITS: Limits = {};

/** The groups and numbers of the answer that are whole, non-negative numbers; anything else is dropped. */
export function parseLimits(raw: unknown): Limits {
  if (typeof raw !== 'object' || raw === null) return NO_LIMITS;
  const out: Record<string, Record<string, number>> = {};
  for (const [group, values] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof values !== 'object' || values === null) continue;
    for (const [key, value] of Object.entries(values as Record<string, unknown>)) {
      if (typeof value === 'number' && Number.isInteger(value) && value >= 0) (out[group] ??= {})[key] = value;
    }
  }
  return out;
}

/** One limit, or the fallback when the server did not send it. */
export function limitOf(limits: Limits, group: string, key: string, fallback: number): number {
  const value = limits[group]?.[key];
  return typeof value === 'number' ? value : fallback;
}
