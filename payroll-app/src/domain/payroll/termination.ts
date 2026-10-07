import { D, round2, toMoney } from "../money";
import { monthsBetween } from "./dates";
import type { PayType } from "./types";

// גמר חשבון: פיצויים, הודעה מוקדמת, פדיון חופשה ודמי הבראה (research/01 §9).

export type TerminationInput = {
  startDate: string;
  endDate: string;
  payType: PayType;
  lastMonthlySalary: number; // שכר קובע (בסיס + תוספות קבועות) – לעובד שעתי: תעריף × 200 × היקף
  hourlyRate?: number;
  jobPercent: number;
  workWeekDays: 5 | 6;
  reason: "dismissal" | "resignation_entitled" | "resignation";
  section14Full: boolean; // הופרשו 8.33% לפיצויים לאורך כל התקופה
  severanceFundBalance: number; // הצבירה בקופה לפיצויים (מהתלושים)
  vacationBalanceDays: number;
  unpaidRecoveryDays: number;
  recoveryDayRate: number;
  exemptPerYear: number; // פטור ממס על פיצויים לשנת ותק
};

export type TerminationResult = {
  seniorityMonths: number;
  seniorityYears: number;
  severanceEntitled: boolean;
  severanceAmount: number;
  severanceFromFund: number;
  severanceTopUp: number;
  severanceTaxExemptCap: number;
  noticeDays: number;
  noticePayInLieu: number;
  vacationRedemption: number;
  recoveryPay: number;
  dayValue: number;
  lines: { label: string; formula: string; amount: number }[];
  notes: string[];
};

/** תקופת הודעה מוקדמת לפי חוק הודעה מוקדמת (בימים) */
export function noticeDays(payType: PayType, months: number): number {
  if (payType === "monthly") {
    if (months < 6) return months; // יום לכל חודש
    if (months < 12) return 6 + Math.floor((months - 6) * 2.5);
    return 30;
  }
  // שעתי/יומי
  if (months < 12) return months;
  if (months < 24) return 14 + Math.floor((months - 12) / 2);
  if (months < 36) return 21 + Math.floor((months - 24) / 2);
  return 30;
}

export function calculateTermination(t: TerminationInput): TerminationResult {
  // ותק: חודשים שלמים מתחילת העבודה ועד היום שאחרי סיומה
  const dayAfter = new Date(Date.parse(t.endDate) + 86400000).toISOString().slice(0, 10);
  const months = monthsBetween(t.startDate, dayAfter);
  const years = D(months).div(12);
  const lines: TerminationResult["lines"] = [];
  const notes: string[] = [];
  const monthly = t.payType === "monthly" ? D(t.lastMonthlySalary) : D(t.hourlyRate ?? 0).times(200).times(D(t.jobPercent).div(100));
  const dayValue = monthly.div(t.workWeekDays === 5 ? 21.67 : 25);

  const entitled = months >= 12 && t.reason !== "resignation";
  let severance = D(0), topUp = D(0);
  if (entitled) {
    severance = round2(monthly.times(years));
    lines.push({ label: "פיצויי פיטורים", formula: `${monthly.toFixed(2)} × ${years.toFixed(4)} שנים`, amount: toMoney(severance) });
    if (t.section14Full) {
      notes.push("חל סעיף 14 מלא (8.33%): הכספים בקופה מחליפים את הפיצויים; אין השלמה.");
    } else {
      topUp = round2(severance.gt(t.severanceFundBalance) ? severance.minus(t.severanceFundBalance) : 0);
      lines.push({ label: "השלמת פיצויים ע״י המעסיק", formula: `${severance.toFixed(2)} − צבירה בקופה ${t.severanceFundBalance.toFixed(2)}`, amount: toMoney(topUp) });
    }
  } else if (months < 12) notes.push("פחות משנת עבודה – אין זכאות לפיצויי פיטורים (למעט חריגים).");
  else notes.push("התפטרות שאינה בנסיבות מזכות – אין זכאות לפיצויים; הכספים בקופה לפי תנאי ההסדר.");

  const nd = noticeDays(t.payType, months);
  const notice = round2(dayValue.times(nd).times(t.payType === "monthly" && nd === 30 ? 21.67 / 30 : 1));
  lines.push({ label: "חלף הודעה מוקדמת (אם לא עבד בתקופה)", formula: `${nd} ימים${t.payType === "monthly" && nd === 30 ? " (חודש = משכורת חודשית)" : ` × ${dayValue.toFixed(2)}`}`, amount: toMoney(nd === 30 && t.payType === "monthly" ? monthly : notice) });

  const vac = round2(dayValue.times(Math.max(0, t.vacationBalanceDays)));
  lines.push({ label: "פדיון חופשה", formula: `${t.vacationBalanceDays} ימים × ${dayValue.toFixed(2)}`, amount: toMoney(vac) });

  const rec = round2(D(t.unpaidRecoveryDays).times(t.recoveryDayRate).times(D(t.jobPercent).div(100)));
  if (t.unpaidRecoveryDays) lines.push({ label: "דמי הבראה שלא שולמו", formula: `${t.unpaidRecoveryDays} × ${t.recoveryDayRate} × ${t.jobPercent}%`, amount: toMoney(rec) });

  const exemptCap = round2(D(t.exemptPerYear).times(years));
  notes.push(`תקרת פטור ממס על פיצויים: ${t.exemptPerYear} ₪ לשנת עבודה ≈ ${exemptCap.toFixed(2)} ₪ (בכפוף לתקרת 1.5 × שכר; טופס 161).`);

  return {
    seniorityMonths: months, seniorityYears: +years.toFixed(2), severanceEntitled: entitled,
    severanceAmount: toMoney(severance), severanceFromFund: entitled ? Math.min(toMoney(severance), t.severanceFundBalance) : 0, severanceTopUp: toMoney(topUp),
    severanceTaxExemptCap: toMoney(exemptCap), noticeDays: nd, noticePayInLieu: nd === 30 && t.payType === "monthly" ? toMoney(monthly) : toMoney(notice),
    vacationRedemption: toMoney(vac), recoveryPay: toMoney(rec), dayValue: toMoney(dayValue), lines, notes,
  };
}
