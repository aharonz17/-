import type { ResolvedRule, RuleKey, RuleSet, RuleVersion } from "./types";

export const ruleId = (r: RuleVersion) => `${r.key}@${r.version}`;

/** בוחר לכל מפתח את הגרסה שבתוקף בתאריך הנתון */
export function resolveRules(versions: RuleVersion[], date: string): RuleSet {
  const chosen = new Map<RuleKey, ResolvedRule<RuleKey>>();
  for (const v of versions) {
    if (v.effectiveFrom > date) continue;
    if (v.effectiveTo && v.effectiveTo < date) continue;
    const cur = chosen.get(v.key);
    if (!cur || cur.effectiveFrom < v.effectiveFrom) chosen.set(v.key, { ...v, id: ruleId(v) });
  }
  return {
    date,
    get<K extends RuleKey>(key: K) {
      const r = chosen.get(key);
      if (!r) throw new MissingRuleError(key, date);
      return r as unknown as ResolvedRule<K>;
    },
    all: () => [...chosen.values()],
  };
}

export class MissingRuleError extends Error {
  constructor(public key: string, public date: string) {
    super(`לא נמצא כלל "${key}" בתוקף לתאריך ${date}`);
  }
}

/** בדיקת חפיפה בין גרסאות של אותו מפתח */
export function findOverlaps(versions: RuleVersion[]): string[] {
  const byKey = new Map<string, RuleVersion[]>();
  for (const v of versions) byKey.set(v.key, [...(byKey.get(v.key) ?? []), v]);
  const errs: string[] = [];
  for (const [key, list] of byKey) {
    const sorted = [...list].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      if (!prev.effectiveTo || prev.effectiveTo >= sorted[i].effectiveFrom)
        errs.push(`${key}: ${prev.version} חופף ל-${sorted[i].version}`);
    }
  }
  return errs;
}
