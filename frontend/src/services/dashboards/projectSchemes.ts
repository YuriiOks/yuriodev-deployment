/** The colour schemes the hub gives projects (tokens `--hub-<name>-*` in _variables.css section 6); the three spaces have their own. */
export const PROJECT_SCHEMES = ['green', 'amber', 'pink', 'blue', 'slate'] as const;

export type ProjectScheme = (typeof PROJECT_SCHEMES)[number];

/**
 * The scheme of a project: picked from its id, so a project keeps its colour wherever it is shown and whatever
 * its name becomes. FNV-1a over the id's UTF-16 units, modulo the number of schemes.
 */
export function projectScheme(id: string): ProjectScheme {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return PROJECT_SCHEMES[hash % PROJECT_SCHEMES.length];
}
