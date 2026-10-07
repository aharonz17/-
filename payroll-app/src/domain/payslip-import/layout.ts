// בניית שורות טקסט מתוך פריטי טקסט של PDF (מיקום x/y), בסדר קריאה מימין לשמאל.

export type TextItem = { str: string; x: number; y: number; w: number };
export type Line = { y: number; items: TextItem[]; text: string };

const RTL_CHARS = /[֐-׿]/;

/** טקסט עברי שנשמר בסדר ויזואלי (הפוך) – מזהים לפי מילים נפוצות הפוכות */
const COMMON = ["שכר", "מס", "ביטוח", "לאומי", "נטו", "ברוטו", "תשלומים", "ניכויים", "הכנסה", "בריאות", "עובד", "פנסיה", "חודש", "משכורת", "תלוש"];
const reverse = (s: string) => [...s].reverse().join("");

export function looksVisualOrder(items: TextItem[]) {
  let normal = 0, reversed = 0;
  for (const it of items) {
    if (!RTL_CHARS.test(it.str)) continue;
    for (const w of COMMON) {
      if (it.str.includes(w)) normal++;
      if (it.str.includes(reverse(w))) reversed++;
    }
  }
  return reversed > normal;
}

/** הופך מקטעים עבריים בטקסט שנשמר בסדר ויזואלי; מספרים נשארים כמו שהם */
export function fixVisualHebrew(s: string) {
  return s.split(/(\s+)/).map((tok) => (RTL_CHARS.test(tok) ? reverse(tok) : tok)).reverse().join("");
}

export function buildLines(raw: TextItem[], tolerance = 3): Line[] {
  const visual = looksVisualOrder(raw);
  const items = raw
    .filter((i) => i.str.trim() !== "")
    .map((i) => ({ ...i, str: (visual ? fixVisualHebrew(i.str) : i.str).replace(/\s+/g, " ").trim() }));
  const sorted = [...items].sort((a, b) => b.y - a.y);
  const lines: Line[] = [];
  for (const it of sorted) {
    const line = lines.find((l) => Math.abs(l.y - it.y) <= tolerance);
    if (line) line.items.push(it);
    else lines.push({ y: it.y, items: [it], text: "" });
  }
  for (const l of lines) {
    l.items.sort((a, b) => b.x - a.x); // ימין לשמאל
    l.text = l.items.map((i) => i.str).join(" ");
  }
  return lines;
}
