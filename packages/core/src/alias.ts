import type { AliasMap } from "@autotos/contracts";

/**
 * Resolve a registrable domain to its canonical domain using an alias map
 * ({ alias -> canonical }). Returns the input unchanged if it has no alias.
 *
 * The lookup is a single hop by design: the derived alias map never chains
 * (every alias points directly at a canonical), so there is no cycle risk.
 */
export function resolveCanonical(
  domain: string,
  aliasMap: AliasMap | undefined | null,
): string {
  if (!aliasMap) return domain;
  return aliasMap.map[domain] ?? domain;
}
