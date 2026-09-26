/** Joins the truthy class names with spaces: cx('a', cond && 'b', undefined) is 'a' or 'a b'. */
export function cx(...classes: ReadonlyArray<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}
