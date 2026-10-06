import type { RuleSet } from "../rules/types";
import { monthIndex, monthsBetween, periodEnd, periodStart } from "./dates";
import type { Gender, TaxFacts } from "./types";

export type CreditPointLine = { label: string; points: number; ruleId?: string };

/** מוצא ערך בטבלה שמפתחותיה גיל בודד ("3") או טווח ("6-17") */
export function lookupAge(table: Record<string, number>, age: number): number {
  for (const [k, v] of Object.entries(table)) {
    const [a, b] = k.split("-").map(Number);
    if (b === undefined ? age === a : age >= a && age <= b) return v;
  }
  return 0;
}

/** חישוב נקודות הזיכוי לחודש מתוך העובדות על העובד (ולא מספר שמוקלד ידנית) */
export function computeCreditPoints(
  facts: TaxFacts,
  gender: Gender,
  period: { year: number; month: number },
  rules: RuleSet,
): CreditPointLine[] {
  const lines: CreditPointLine[] = [];
  const personal = rules.get("credit_points.personal");
  const start = periodStart(period.year, period.month);
  const end = periodEnd(period.year, period.month);

  if (facts.resident) lines.push({ label: "תושב/ת ישראל", points: personal.payload.resident, ruleId: personal.id });
  if (gender === "female") lines.push({ label: "אישה", points: personal.payload.woman, ruleId: personal.id });
  if (facts.singleParent) lines.push({ label: "הורה יחיד", points: personal.payload.singleParent, ruleId: personal.id });
  if (facts.alimonyOrRemarriage) lines.push({ label: "מזונות / נישואין חוזרים", points: personal.payload.alimonyOrRemarriage, ruleId: personal.id });

  // ילדים – הגיל בשנת המס = שנת המס פחות שנת הלידה
  const children = facts.children ?? [];
  if (children.length) {
    const ch = rules.get("credit_points.children");
    const table = gender === "female" ? ch.payload.mother : ch.payload.father;
    let toddler: ReturnType<RuleSet["get"]> | null = null;
    try { toddler = rules.get("credit_points.toddler_addition"); } catch { toddler = null; }
    children.forEach((c, i) => {
      const birthYear = Number(c.birthDate.slice(0, 4));
      if (birthYear > period.year) return;
      // ילד שטרם נולד בחודש זה – לא נספר (חוץ מהשנה כולה בשנת הלידה לפי מעסיק; כאן לפי חודש הלידה)
      if (birthYear === period.year && c.birthDate > end) return;
      const age = period.year - birthYear;
      const p = lookupAge(table, age);
      if (p) lines.push({ label: `ילד ${i + 1} (גיל ${age} בשנת המס)`, points: p, ruleId: ch.id });
      if (toddler) {
        const add = lookupAge((toddler.payload as { byAge: Record<string, number> }).byAge, age);
        if (add) lines.push({ label: `תוספת פעוט – ילד ${i + 1}`, points: add, ruleId: toddler.id });
      }
      if (c.disabled) lines.push({ label: `ילד עם מוגבלות – ילד ${i + 1}`, points: personal.payload.disabledChildPerChild, ruleId: personal.id });
    });
  }

  // חייל/ת משוחרר/ת – 36 חודשים מהחודש שלאחר השחרור
  if (facts.dischargedSoldier?.dischargeDate) {
    const r = rules.get("credit_points.discharged_soldier");
    const firstMonth = monthIndex(facts.dischargedSoldier.dischargeDate) + 1;
    const cur = monthIndex(start);
    if (cur >= firstMonth && cur < firstMonth + r.payload.months) {
      const s = facts.dischargedSoldier.serviceMonths;
      const fullMin = gender === "female" ? r.payload.full.minServiceMonthsFemale : r.payload.full.minServiceMonthsMale;
      const pts = s >= fullMin ? r.payload.full.points : s >= r.payload.partial.minServiceMonths ? r.payload.partial.points : 0;
      if (pts) lines.push({ label: "חייל/ת משוחרר/ת", points: pts, ruleId: r.id });
    }
  }

  // תואר – בשנת המס שלאחר סיום התואר
  if (facts.degree && facts.degree.completionYear + 1 === period.year) {
    const r = rules.get("credit_points.degree");
    const pts = facts.degree.type === "bachelor" ? r.payload.bachelor : r.payload.master;
    lines.push({ label: facts.degree.type === "bachelor" ? "תואר ראשון" : "תואר שני", points: pts, ruleId: r.id });
  }

  // עולה חדש
  if (facts.newImmigrant?.aliyahDate) {
    const r = rules.get("credit_points.new_immigrant");
    if (facts.newImmigrant.aliyahDate <= end) {
      const m = monthsBetween(facts.newImmigrant.aliyahDate, start);
      const per = r.payload.periods.find((p) => m >= p.fromMonth && m <= p.toMonth);
      if (per) lines.push({ label: `עולה חדש (חודש ${m + 1} מהעלייה)`, points: per.points, ruleId: r.id });
    }
  }

  // לוחמי מילואים (מ-2026)
  if (facts.reserveCombatDaysPrevYear) {
    try {
      const r = rules.get("credit_points.reserve_combat");
      const row = [...r.payload.table].reverse().find((t) => facts.reserveCombatDaysPrevYear! >= t.minDays);
      if (row) lines.push({ label: `לוחם מילואים (${facts.reserveCombatDaysPrevYear} ימים)`, points: row.points, ruleId: r.id });
    } catch {
      /* הכלל לא בתוקף בשנה זו */
    }
  }

  if (facts.additionalPoints) lines.push({ label: facts.additionalPointsNote || "נקודות נוספות (ידני)", points: facts.additionalPoints });

  return lines;
}
