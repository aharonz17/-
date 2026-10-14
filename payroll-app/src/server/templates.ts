import { getDb, json } from "./db";
import { audit } from "./audit";
import { DEFAULT_TEMPLATE, type PayslipTemplate } from "@/pdf/payslip-html";

// תבנית תלוש לכל מעסיק: פריסה, צבע, טקסטים, קודי שכר ולוגו (של המעסיק בלבד).

export const MAX_LOGO_BYTES = 500 * 1024;

type Row = { employer_id: number; template_json: string; logo_blob: Uint8Array | null; logo_mime: string | null; updated_at: string };
const row = (employerId: number) => getDb().prepare("SELECT * FROM payslip_templates WHERE employer_id = ?").get(employerId) as Row | undefined;
const ensure = (employerId: number) => getDb().prepare("INSERT OR IGNORE INTO payslip_templates (employer_id) VALUES (?)").run(employerId);

export function getTemplate(employerId: number): PayslipTemplate {
  const t = json<Partial<PayslipTemplate>>(row(employerId)?.template_json, {});
  return { ...DEFAULT_TEMPLATE, ...t, codes: t.codes ?? {} };
}

export function saveTemplate(employerId: number, t: PayslipTemplate, actor?: string) {
  ensure(employerId);
  const old = getTemplate(employerId);
  getDb().prepare("UPDATE payslip_templates SET template_json = ?, updated_at = datetime('now') WHERE employer_id = ?").run(JSON.stringify(t), employerId);
  audit({ entityType: "payslip_template", entityId: employerId, action: "UPDATE", actor, oldValue: old, newValue: t });
}

/** זיהוי סוג תמונה לפי חתימת הקובץ (לא לפי הסיומת) */
export function imageMime(buf: Uint8Array): "image/png" | "image/jpeg" | null {
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  return null;
}

export function saveLogo(employerId: number, buf: Buffer, actor?: string) {
  if (buf.length > MAX_LOGO_BYTES) throw new Error("הלוגו גדול מ-500KB.");
  const mime = imageMime(buf);
  if (!mime) throw new Error("הלוגו חייב להיות קובץ PNG או JPG.");
  ensure(employerId);
  getDb().prepare("UPDATE payslip_templates SET logo_blob = ?, logo_mime = ?, updated_at = datetime('now') WHERE employer_id = ?").run(buf, mime, employerId);
  audit({ entityType: "payslip_template", entityId: employerId, action: "LOGO_UPLOAD", actor, newValue: { bytes: buf.length, mime } });
}

export function removeLogo(employerId: number, actor?: string) {
  getDb().prepare("UPDATE payslip_templates SET logo_blob = NULL, logo_mime = NULL WHERE employer_id = ?").run(employerId);
  audit({ entityType: "payslip_template", entityId: employerId, action: "LOGO_REMOVE", actor });
}

export function logoDataUri(employerId: number): string | null {
  const r = row(employerId);
  if (!r?.logo_blob || !r.logo_mime) return null;
  return `data:${r.logo_mime};base64,${Buffer.from(r.logo_blob).toString("base64")}`;
}
