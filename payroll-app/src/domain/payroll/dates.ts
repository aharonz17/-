// עזרי תאריכים (מחרוזות YYYY-MM-DD, בלי אזורי זמן)

export const pad2 = (n: number) => String(n).padStart(2, "0");
export const periodStart = (y: number, m: number) => `${y}-${pad2(m)}-01`;
export const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
export const periodEnd = (y: number, m: number) => `${y}-${pad2(m)}-${pad2(daysInMonth(y, m))}`;
export const periodLabel = (y: number, m: number) => `${pad2(m)}/${y}`;

export function parseDate(s: string) {
  const [y, m, d] = s.split("-").map(Number);
  return { y, m, d };
}

/** חודשים שלמים בין שני תאריכים (from עד to) */
export function monthsBetween(from: string, to: string) {
  const a = parseDate(from), b = parseDate(to);
  let months = (b.y - a.y) * 12 + (b.m - a.m);
  if (b.d < a.d) months -= 1;
  return Math.max(0, months);
}

/** חודש-מספר (שנה*12+חודש) לצורך השוואת תקופות */
export const monthIndex = (s: string) => {
  const { y, m } = parseDate(s);
  return y * 12 + (m - 1);
};

export function ageAt(birthDate: string | null | undefined, at: string): number | null {
  if (!birthDate) return null;
  return Math.floor(monthsBetween(birthDate, at) / 12);
}

export function addMonths(date: string, n: number) {
  const { y, m, d } = parseDate(date);
  const idx = y * 12 + (m - 1) + n;
  const ny = Math.floor(idx / 12), nm = (idx % 12) + 1;
  return `${ny}-${pad2(nm)}-${pad2(Math.min(d, daysInMonth(ny, nm)))}`;
}

export const isValidDate = (s: unknown): s is string =>
  typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
