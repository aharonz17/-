// עזרי קריאת FormData בצד השרת

export const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  const s = typeof v === "string" ? v.trim() : "";
  return s === "" ? null : s;
};
export const reqStr = (fd: FormData, k: string, label: string) => {
  const v = str(fd, k);
  if (!v) throw new Error(`חסר שדה: ${label}`);
  return v;
};
export const num = (fd: FormData, k: string) => {
  const v = str(fd, k);
  if (v === null) return null;
  const n = Number(v.replace(/,/g, ""));
  if (!Number.isFinite(n)) throw new Error(`ערך מספרי לא תקין בשדה ${k}`);
  return n;
};
export const num0 = (fd: FormData, k: string) => num(fd, k) ?? 0;
export const bool = (fd: FormData, k: string) => fd.get(k) === "on" || fd.get(k) === "1" || fd.get(k) === "true";
export const date = (fd: FormData, k: string) => {
  const v = str(fd, k);
  if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error(`תאריך לא תקין בשדה ${k}`);
  return v;
};
/** אחוז שהוזן כמספר (6) → שבר (0.06) */
export const pct = (fd: FormData, k: string) => {
  const v = num(fd, k);
  return v === null ? null : v / 100;
};

/** בדיקת ספרת ביקורת של תעודת זהות ישראלית */
export function validIsraeliId(id: string) {
  const s = id.replace(/\D/g, "");
  if (!s || s.length > 9) return false;
  const p = s.padStart(9, "0");
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    let d = Number(p[i]) * ((i % 2) + 1);
    if (d > 9) d -= 9;
    sum += d;
  }
  return sum % 10 === 0;
}
