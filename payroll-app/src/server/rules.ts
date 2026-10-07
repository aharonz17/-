import { getDb, json } from "./db";
import { resolveRules } from "@/domain/rules/resolve";
import type { RuleKey, RuleVersion } from "@/domain/rules/types";

export type RuleRow = {
  id: string; key: RuleKey; version: string; effective_from: string; effective_to: string | null; payload_json: string;
  source_name: string; source_url: string | null; verified: number; notes: string | null; origin: string; created_at: string;
};

export function loadRuleVersions(): RuleVersion[] {
  const rows = getDb().prepare("SELECT * FROM rule_versions").all() as RuleRow[];
  return rows.map((r) => ({
    key: r.key, version: r.version, effectiveFrom: r.effective_from, effectiveTo: r.effective_to,
    payload: json(r.payload_json, {}) as never, source: { name: r.source_name, url: r.source_url ?? undefined },
    verified: !!r.verified, notes: r.notes ?? undefined,
  }));
}

export const rulesAt = (date: string) => resolveRules(loadRuleVersions(), date);

export const listRuleRows = () => getDb().prepare("SELECT * FROM rule_versions ORDER BY key, effective_from DESC").all() as RuleRow[];

export function addRuleVersion(r: RuleVersion) {
  getDb().prepare(`INSERT INTO rule_versions (id, key, version, effective_from, effective_to, payload_json, source_name, source_url, verified, notes, origin)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'user')`).run(
    `${r.key}@${r.version}`, r.key, r.version, r.effectiveFrom, r.effectiveTo, JSON.stringify(r.payload),
    r.source.name, r.source.url ?? null, r.verified ? 1 : 0, r.notes ?? null);
}

export function closeRuleVersion(id: string, effectiveTo: string) {
  getDb().prepare("UPDATE rule_versions SET effective_to = ?, origin = CASE WHEN origin = 'seed' THEN 'seed-edited' ELSE origin END WHERE id = ?").run(effectiveTo, id);
}
