// Semantic version comparison.
//
// Pure, and in lib/ rather than beside the config hook, because the hook
// imports expo-application and this needs to be testable without a native
// module — which is exactly the kind of coupling that leaves the risky logic
// untested.

/**
 * Is `current` older than `target`?
 *
 * Compared NUMERICALLY, segment by segment. String comparison is the classic
 * wrong answer: '1.10.0' < '1.9.0' is true alphabetically, so the tenth
 * release of a line would be treated as older than the ninth and force-updated
 * forever — by a gate the user cannot dismiss.
 *
 * A malformed segment parses to 0 rather than NaN, so a garbage version string
 * can never accidentally trip a floor and lock everyone out.
 */
export function isOlderThan(current: string, target: string): boolean {
  const a = current.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const b = target.split('.').map((part) => Number.parseInt(part, 10) || 0);

  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const left = a[index] ?? 0;
    const right = b[index] ?? 0;
    if (left !== right) return left < right;
  }
  return false;
}
