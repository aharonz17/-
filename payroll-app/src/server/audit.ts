import { getDb } from "./db";

// רישום שינויים. ערכים רגישים (ת"ז, חשבון בנק) נשמרים כאן כפי שהם – ה-DB עצמו הוא האזור המוגן;
// הם לא נכתבים ללוגים של האפליקציה.
export function audit(e: {
  entityType: string; entityId: string | number; action: string; actor?: string | null;
  oldValue?: unknown; newValue?: unknown; source?: string; reason?: string;
}) {
  getDb().prepare(`INSERT INTO audit_events (entity_type, entity_id, action, actor, old_value, new_value, source, reason)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    e.entityType, String(e.entityId), e.action, e.actor ?? null,
    e.oldValue === undefined ? null : JSON.stringify(e.oldValue),
    e.newValue === undefined ? null : JSON.stringify(e.newValue),
    e.source ?? "ui", e.reason ?? null,
  );
}

export type AuditRow = { id: number; entity_type: string; entity_id: string; action: string; actor: string | null; old_value: string | null; new_value: string | null; source: string | null; reason: string | null; created_at: string };

export function listAudit(filter: { entityType?: string; entityId?: string; limit?: number } = {}) {
  const where: string[] = [];
  const args: unknown[] = [];
  if (filter.entityType) { where.push("entity_type = ?"); args.push(filter.entityType); }
  if (filter.entityId) { where.push("entity_id = ?"); args.push(filter.entityId); }
  return getDb().prepare(`SELECT * FROM audit_events ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY id DESC LIMIT ?`)
    .all(...args, filter.limit ?? 200) as AuditRow[];
}
