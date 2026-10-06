import { D, Decimal, ZERO, round2, sum, toMoney } from "../money";
import type { RuleKey, RuleSet } from "../rules/types";
import { CORE, EXTRA, type ComponentDef } from "./catalog";
import { computeCreditPoints } from "./credit-points";
import { addMonths, ageAt, daysInMonth, isValidDate, monthIndex, monthsBetween, parseDate, periodEnd, periodStart } from "./dates";
import { bracketTax, marginalRate, twoTier } from "./tax";
import type { BalanceResult, Message, PayrollInput, PayrollResult, PayslipLine, TraceStep } from "./types";

type Line = PayslipLine & { def: ComponentDef; value: Decimal };

const fmt = (v: Decimal.Value) => D(v).toDecimalPlaces(2).toNumber().toLocaleString("en-US", { maximumFractionDigits: 2 });
const pctS = (r: number) => `${+(r * 100).toFixed(4)}%`;

/**
 * מנוע השכר: Pipeline דטרמיניסטי. הקלט הוא Snapshot של כל הנתונים, הכללים נטענים לפי תקופת השכר.
 * אין כאן גישה ל-DB או ל-UI.
 */
export function calculatePayroll(input: PayrollInput, rules: RuleSet): PayrollResult {
  const messages: Message[] = [];
  const trace: TraceStep[] = [];
  const used = new Set<string>();
  const rule = <K extends RuleKey>(k: K) => {
    const r = rules.get(k);
    used.add(r.id);
    return r;
  };
  const step = (section: string, label: string, formula: string, amount: Decimal.Value, ruleIds?: string[]) =>
    trace.push({ section, label, formula, amount: toMoney(amount), ruleIds });

  const { period, employment: emp, attendance: att } = input;
  const start = periodStart(period.year, period.month);
  const end = periodEnd(period.year, period.month);

  // ───── 1. ולידציה ─────
  validate(input, messages);
  if (messages.some((m) => m.level === "ERROR")) {
    throw new PayrollValidationError(messages);
  }

  const hours = rule("work_hours");
  const otRates = rule("overtime.rates");
  const minWage = rule("min_wage");
  const sick = rule("sick.rules");

  const jobPct = D(emp.jobPercent).div(100);
  const stdHours = emp.standardMonthlyHours ?? hours.payload.standardMonthlyHours;
  const dailyHours = D(hours.payload.weeklyHours).div(emp.workWeekDays).times(jobPct);
  const workDaysPerMonth = emp.workWeekDays === 5 ? hours.payload.workDaysPerMonth5 : hours.payload.workDaysPerMonth6;
  const age = ageAt(input.employee.birthDate, end);
  const seniorityMonths = monthsBetween(emp.startDate, end) + (emp.priorSeniorityMonths ?? 0);
  const seniorityYear = Math.floor(seniorityMonths / 12) + 1;

  // שבר החודש שבו העובד הועסק (חודש ראשון/אחרון חלקי)
  const dim = daysInMonth(period.year, period.month);
  let employedFrom = 1, employedTo = dim;
  if (emp.startDate > start) employedFrom = parseDate(emp.startDate).d;
  if (emp.endDate && emp.endDate < end) employedTo = parseDate(emp.endDate).d;
  const monthFraction = D(Math.max(0, employedTo - employedFrom + 1)).div(dim);

  const lines: Line[] = [];
  const add = (def: ComponentDef, value: Decimal.Value, extra: Partial<PayslipLine> = {}) => {
    const v = round2(value);
    if (v.isZero() && !extra.quantity) return;
    lines.push({ ...extra, code: def.code, name: extra.name ?? def.name, category: def.category, amount: v.toNumber(), def, value: v });
  };

  // ───── 2. ערך שעה / יום ─────
  let hourValue = ZERO, dayValue = ZERO;
  if (emp.payType === "monthly") {
    hourValue = D(emp.baseSalary!).div(D(stdHours).times(jobPct));
    dayValue = D(emp.baseSalary!).div(workDaysPerMonth);
  } else if (emp.payType === "hourly") {
    hourValue = D(emp.hourlyRate!);
    dayValue = hourValue.times(dailyHours);
  } else {
    dayValue = D(emp.dailyRate!);
    hourValue = dayValue.div(D(hours.payload.weeklyHours).div(emp.workWeekDays));
  }
  // תוספות קבועות שנכנסות לערך השעה לש"נ
  const fixedSupp = sum((input.components ?? []).filter((c) => EXTRA[c.type].overtimeBase).map((c) => componentAmount(c)));
  const otHourValue = emp.payType === "monthly" ? D(emp.baseSalary!).plus(fixedSupp).div(D(stdHours).times(jobPct)) : hourValue;

  // ───── 3. רכיבי תשלום ─────
  const sec = "ברוטו";
  if (emp.payType === "monthly") {
    const base = D(emp.baseSalary!).times(monthFraction);
    add(CORE.BASE, base, { quantity: emp.jobPercent, pct: emp.jobPercent });
    step(sec, "משכורת בסיס", monthFraction.lt(1)
      ? `${fmt(emp.baseSalary!)} × ${employedTo - employedFrom + 1}/${dim} ימים (חודש חלקי)`
      : `${fmt(emp.baseSalary!)} (היקף משרה ${emp.jobPercent}%)`, base);
    if (att.unpaidDays) {
      const v = dayValue.times(att.unpaidDays).neg();
      add(CORE.UNPAID_ABSENCE, v, { quantity: att.unpaidDays, rate: toMoney(dayValue) });
      step(sec, "היעדרות ללא תשלום", `−${att.unpaidDays} ימים × ערך יום ${fmt(dayValue)} (${fmt(emp.baseSalary!)} ÷ ${workDaysPerMonth})`, v, [hours.id]);
    }
  } else if (emp.payType === "hourly") {
    const h = att.regularHours ?? 0;
    const v = hourValue.times(h);
    add(CORE.REGULAR_HOURS, v, { quantity: h, rate: toMoney(hourValue) });
    step(sec, "שעות רגילות", `${h} שעות × ${fmt(hourValue)}`, v);
  } else {
    const v = dayValue.times(att.workDays);
    add(CORE.WORK_DAYS, v, { quantity: att.workDays, rate: toMoney(dayValue) });
    step(sec, "ימי עבודה", `${att.workDays} ימים × ${fmt(dayValue)}`, v);
  }

  // מחלה
  const sickDaysTotal = (att.sickEpisodes ?? []).reduce((a, e) => a + e.days, 0);
  if (sickDaysTotal) {
    let paidFactor = ZERO;
    const breakdown: string[] = [];
    for (const ep of att.sickEpisodes ?? []) {
      for (let i = 0; i < ep.days; i++) {
        const dayNo = (ep.continuesFromDay ?? 0) + i; // 0-based
        const pct = sick.payload.payPctByDay[Math.min(dayNo, sick.payload.payPctByDay.length - 1)];
        paidFactor = paidFactor.plus(pct);
        breakdown.push(`${pct * 100}%`);
      }
    }
    const sickDayValue = emp.payType === "monthly" ? dayValue : emp.payType === "hourly" ? hourValue.times(dailyHours) : dayValue;
    if (emp.payType === "monthly") {
      const unpaid = sickDayValue.times(D(sickDaysTotal).minus(paidFactor)).neg();
      if (!unpaid.isZero()) add(CORE.SICK_UNPAID, unpaid, { quantity: sickDaysTotal });
      step(sec, "מחלה – חלק לא משולם", `${sickDaysTotal} ימי מחלה [${breakdown.join(", ")}] → ניכוי ${fmt(D(sickDaysTotal).minus(paidFactor))} ימים × ${fmt(sickDayValue)}`, unpaid, [sick.id]);
    } else {
      const paid = sickDayValue.times(paidFactor);
      add(CORE.SICK_PAY, paid, { quantity: sickDaysTotal, rate: toMoney(sickDayValue) });
      step(sec, "דמי מחלה", `ימים [${breakdown.join(", ")}] × ${fmt(sickDayValue)}`, paid, [sick.id]);
    }
  }

  // חופשה ודמי חג לעובד שעתי/יומי (לעובד חודשי – השכר לא משתנה)
  if (emp.payType !== "monthly") {
    const dv = emp.payType === "hourly" ? hourValue.times(dailyHours) : dayValue;
    if (att.vacationDays) {
      const v = dv.times(att.vacationDays);
      add(CORE.VACATION_PAY, v, { quantity: att.vacationDays, rate: toMoney(dv) });
      step(sec, "דמי חופשה", `${att.vacationDays} ימים × ${fmt(dv)} (הערכה לפי ערך יום; החוק: שכר יומי ממוצע)`, v);
    }
    if (att.holidayPaidDays) {
      if (seniorityMonths < 3) messages.push({ level: "WARNING", code: "HOLIDAY_SENIORITY", text: "דמי חג משולמים לעובד שעתי/יומי רק אחרי 3 חודשי עבודה." });
      const v = dv.times(att.holidayPaidDays);
      add(CORE.HOLIDAY_PAY, v, { quantity: att.holidayPaidDays, rate: toMoney(dv) });
      step(sec, "דמי חג", `${att.holidayPaidDays} ימים × ${fmt(dv)}`, v);
    }
  }

  // שעות נוספות
  const ot: [keyof typeof att, ComponentDef, number][] = [
    ["ot125", CORE.OT125, otRates.payload.first2],
    ["ot150", CORE.OT150, otRates.payload.after2],
    ["rest150", CORE.REST150, otRates.payload.rest],
    ["rest175", CORE.REST175, otRates.payload.restOtFirst2],
    ["rest200", CORE.REST200, otRates.payload.restOtAfter2],
    ["holiday150", CORE.HOLIDAY150, otRates.payload.holiday],
  ];
  for (const [k, def, r] of ot) {
    const q = Number(att[k] ?? 0);
    if (!q) continue;
    const v = otHourValue.times(r).times(q);
    add(def, v, { quantity: q, rate: toMoney(otHourValue.times(r)), pct: r * 100 });
    step(sec, def.name, `${q} שעות × ערך שעה ${fmt(otHourValue)} × ${pctS(r)}`, v, [otRates.id]);
  }

  // נסיעות
  if (input.travel && input.travel.dailyFare > 0 && att.workDays > 0) {
    const cap = rule("travel.cap");
    const perDay = Decimal.min(input.travel.dailyFare, cap.payload.dailyCap);
    let v = perDay.times(att.workDays);
    let f = `${att.workDays} ימי עבודה × min(${fmt(input.travel.dailyFare)}, תקרה ${fmt(cap.payload.dailyCap)})`;
    if (input.travel.monthlyPass && v.gt(input.travel.monthlyPass)) {
      v = D(input.travel.monthlyPass);
      f += ` → מוגבל לחופשי-חודשי ${fmt(input.travel.monthlyPass)}`;
    }
    add(CORE.TRAVEL, v, { quantity: att.workDays, rate: toMoney(perDay) });
    step(sec, "נסיעות", f, v, [cap.id]);
  }

  // הבראה
  const rec = rule("recovery_pay");
  const recDays = [...rec.payload.daysBySeniority].reverse().find((r) => seniorityYear >= r.fromYear)?.days ?? 0;
  if (input.recovery && input.recovery.mode !== "none") {
    const rate = rec.payload.dayRate[input.employer.sector];
    const days = input.recovery.mode === "monthly" ? D(recDays).div(12) : D(input.recovery.days ?? 0);
    const v = days.times(rate).times(jobPct);
    if (seniorityMonths < 12 && input.recovery.mode === "monthly")
      messages.push({ level: "INFO", code: "RECOVERY_FIRST_YEAR", text: "הזכאות לדמי הבראה נוצרת לאחר שנת עבודה; תשלום חודשי בשנה הראשונה הוא מקדמה." });
    add(CORE.RECOVERY, v, { quantity: toMoney(days), rate });
    step(sec, "דמי הבראה", `${fmt(days)} ימים × ${fmt(rate)} ₪ (${input.employer.sector === "public" ? "ציבורי" : "פרטי"}) × היקף משרה ${emp.jobPercent}%` +
      (input.recovery.mode === "monthly" ? ` [זכאות שנתית ${recDays} ימים לשנת ותק ${seniorityYear} ÷ 12]` : ""), v, [rec.id]);
  }

  // רכיבים נוספים (בונוס, עמלות, הטבות, ניכויי רשות...)
  for (const c of input.components ?? []) {
    const def = EXTRA[c.type];
    const v = componentAmount(c);
    const name = c.description ? `${def.name} – ${c.description}` : def.name;
    add(def, v, { name, quantity: c.quantity, rate: c.rate });
    if (def.category === "earning" || def.category === "reimbursement" || def.category === "benefit")
      step(def.category === "benefit" ? "שווי" : sec, name, c.quantity && c.rate ? `${c.quantity} × ${fmt(c.rate)}` : "סכום שהוזן", v);
  }

  // ───── 4. זקיפות שווי ─────
  if (input.car && input.car.listPrice > 0) {
    const car = rule("car_benefit");
    const price = Decimal.min(input.car.listPrice, car.payload.priceCap);
    const reduction = input.car.kind === "regular" ? 0 : car.payload.greenReduction[input.car.kind];
    const v = Decimal.max(ZERO, price.times(car.payload.rate).minus(reduction).minus(input.car.employeeContribution ?? 0));
    add(CORE.CAR, v);
    step("שווי", "שווי רכב", `min(מחירון ${fmt(input.car.listPrice)}, תקרה ${fmt(car.payload.priceCap)}) × ${pctS(car.payload.rate)}` +
      (reduction ? ` − הפחתת רכב ירוק ${fmt(reduction)}` : "") + (input.car.employeeContribution ? ` − השתתפות עובד ${fmt(input.car.employeeContribution)}` : ""), v, [car.id]);
  }
  if (input.phone && input.phone.monthlyCost > 0) {
    const ph = rule("phone_benefit");
    const v = Decimal.max(ZERO, Decimal.min(ph.payload.maxMonthly, D(input.phone.monthlyCost).times(ph.payload.pctOfCost)).minus(input.phone.employeePaid ?? 0));
    add(CORE.PHONE, v);
    step("שווי", "שווי טלפון נייד", `min(${ph.payload.maxMonthly}, ${pctS(ph.payload.pctOfCost)} × ${fmt(input.phone.monthlyCost)})` + (input.phone.employeePaid ? ` − ${fmt(input.phone.employeePaid)}` : ""), v, [ph.id]);
  }

  // ───── 5. בסיסי חישוב ─────
  const earnings = () => lines.filter((l) => l.category === "earning");
  const grossPay = sum(earnings().map((l) => l.value));
  const pensionBase = Decimal.max(ZERO, sum(lines.filter((l) => l.def.pension).map((l) => l.value)));
  step("בסיסים", "ברוטו לתשלום", earnings().map((l) => `${l.name} ${fmt(l.value)}`).join(" + ") || "0", grossPay);
  step("בסיסים", "שכר לפנסיה", "רכיבים המסומנים כשכר קובע (בסיס, תוספות קבועות, עמלות, מחלה/חופשה)", pensionBase);

  // ───── 6. פנסיה ─────
  const pens = input.pension;
  let pensionActive = false;
  const pensionRes = { base: 0, employee: ZERO, employer: ZERO, disability: ZERO, severance: ZERO };
  if (pens?.enabled) {
    const mand = rule("pension.mandatory");
    let startDate = pens.startDate;
    if (!startDate) {
      const wait = pens.hasExistingFund ? 0 : mand.payload.waitingMonthsNoFund;
      startDate = addMonths(emp.startDate, wait);
      if (wait) messages.push({ level: "INFO", code: "PENSION_WAITING", text: `תאריך תחילת הפרשה לפנסיה חושב לפי תקופת המתנה (${wait} חודשים): ${startDate}.` });
    }
    pensionActive = monthIndex(start) >= monthIndex(startDate);
    if (!pensionActive) {
      messages.push({ level: "INFO", code: "PENSION_NOT_STARTED", text: `הפרשות פנסיה יתחילו מ-${startDate}.` });
    } else {
      if (pens.employeeRate < mand.payload.employee || pens.employerRate < mand.payload.employer || pens.severanceRate < mand.payload.severance)
        messages.push({ level: "WARNING", code: "PENSION_BELOW_MIN", text: `שיעורי הפנסיה נמוכים מהמינימום בצו ההרחבה (${pctS(mand.payload.employee)} / ${pctS(mand.payload.employer)} / ${pctS(mand.payload.severance)}).` });
      pensionRes.base = toMoney(pensionBase);
      pensionRes.employee = round2(pensionBase.times(pens.employeeRate));
      pensionRes.employer = round2(pensionBase.times(pens.employerRate));
      pensionRes.disability = round2(pensionBase.times(pens.disabilityRate ?? 0));
      pensionRes.severance = round2(pensionBase.times(pens.severanceRate));
      add(CORE.PENSION_EMP, pensionRes.employee, { rate: pens.employeeRate * 100, name: pens.provider ? `${CORE.PENSION_EMP.name} (${pens.provider})` : undefined });
      add(CORE.ER_PENSION, pensionRes.employer, { rate: pens.employerRate * 100 });
      add(CORE.ER_DISABILITY, pensionRes.disability, { rate: (pens.disabilityRate ?? 0) * 100 });
      add(CORE.ER_SEVERANCE, pensionRes.severance, { rate: pens.severanceRate * 100 });
      step("פנסיה", "פנסיה עובד", `${fmt(pensionBase)} × ${pctS(pens.employeeRate)}`, pensionRes.employee, [mand.id]);
      step("פנסיה", "תגמולי מעסיק", `${fmt(pensionBase)} × ${pctS(pens.employerRate)}`, pensionRes.employer, [mand.id]);
      if (pens.disabilityRate) step("פנסיה", "אובדן כושר עבודה (מעסיק)", `${fmt(pensionBase)} × ${pctS(pens.disabilityRate)}`, pensionRes.disability);
      step("פנסיה", "פיצויים", `${fmt(pensionBase)} × ${pctS(pens.severanceRate)}`, pensionRes.severance, [mand.id]);

      // זקיפת הפרשת מעסיק לתגמולים מעל התקרה
      const ptax = rule("pension.tax");
      const exempt = Decimal.min(pensionBase, ptax.payload.employerExemptSalaryCap).times(ptax.payload.employerExemptRate);
      const excess = Decimal.max(ZERO, pensionRes.employer.plus(pensionRes.disability).minus(exempt));
      if (excess.gt(0)) {
        add(CORE.PENSION_IMPUTED, excess);
        step("שווי", "זקיפת פנסיה מעל התקרה", `(${fmt(pensionRes.employer)} + ${fmt(pensionRes.disability)}) − ${pctS(ptax.payload.employerExemptRate)} × min(${fmt(pensionBase)}, ${fmt(ptax.payload.employerExemptSalaryCap)})`, excess, [ptax.id]);
      }
    }
  } else {
    messages.push({ level: "WARNING", code: "NO_PENSION", text: "לעובד לא הוגדרה פנסיה. פנסיה היא חובה לפי צו ההרחבה (אחרי תקופת ההמתנה)." });
  }

  // ───── 7. קרן השתלמות ─────
  const sf = input.studyFund;
  const sfRes = { base: 0, employee: ZERO, employer: ZERO, imputed: ZERO, active: false };
  if (sf?.enabled) {
    const sfr = rule("study_fund");
    const cap = sfr.payload.salaryCap;
    const cBase = sf.capAtCeiling ? Decimal.min(pensionBase, cap) : pensionBase;
    sfRes.active = true;
    sfRes.base = toMoney(cBase);
    sfRes.employee = round2(cBase.times(sf.employeeRate));
    sfRes.employer = round2(cBase.times(sf.employerRate));
    add(CORE.STUDY_EMP, sfRes.employee, { rate: sf.employeeRate * 100 });
    add(CORE.ER_STUDY, sfRes.employer, { rate: sf.employerRate * 100 });
    step("קרן השתלמות", "קרן השתלמות עובד", `${sf.capAtCeiling ? `min(${fmt(pensionBase)}, תקרה ${fmt(cap)})` : fmt(pensionBase)} × ${pctS(sf.employeeRate)}`, sfRes.employee, [sfr.id]);
    step("קרן השתלמות", "קרן השתלמות מעסיק", `${fmt(cBase)} × ${pctS(sf.employerRate)}`, sfRes.employer, [sfr.id]);
    const exempt = D(cap).times(sfr.payload.employer);
    const excess = Decimal.max(ZERO, sfRes.employer.minus(exempt));
    if (excess.gt(0)) {
      sfRes.imputed = round2(excess);
      add(CORE.STUDY_FUND_IMPUTED, excess);
      step("שווי", "זקיפת קרן השתלמות", `הפרשת מעסיק ${fmt(sfRes.employer)} − פטור ${pctS(sfr.payload.employer)} × ${fmt(cap)} = ${fmt(exempt)}`, excess, [sfr.id]);
    }
  }

  // ───── 8. הכנסה חייבת ─────
  const benefits = lines.filter((l) => l.category === "benefit");
  const taxable = Decimal.max(ZERO, sum(lines.filter((l) => l.def.incomeTax && (l.category === "earning" || l.category === "benefit")).map((l) => l.value)));
  const niBaseRaw = Decimal.max(ZERO, sum(lines.filter((l) => l.def.nationalInsurance && (l.category === "earning" || l.category === "benefit")).map((l) => l.value)));
  step("בסיסים", "הכנסה חייבת במס", `ברוטו חייב ${fmt(sum(lines.filter((l) => l.def.incomeTax && l.category === "earning").map((l) => l.value)))}` +
    (benefits.length ? ` + שווי ${benefits.map((b) => fmt(b.value)).join(" + ")}` : ""), taxable);

  // ───── 9. מס הכנסה ─────
  const brackets = rule("income_tax.brackets");
  const cpValue = rule("credit_point.value");
  const sec2 = rule("secondary_employment");
  const ptax = rule("pension.tax");
  let creditLines = computeCreditPoints(input.taxFacts, input.employee.gender, period, rules);
  creditLines.forEach((l) => l.ruleId && used.add(l.ruleId));
  let method: PayrollResult["tax"]["method"] = input.taxSettings.method;
  let incomeTax = ZERO, beforeCredits = ZERO, cpAmount = ZERO, pensionCredit = ZERO, settlementCredit = ZERO;

  const ytdIn = input.ytd ?? { months: 0, gross: 0, taxableIncome: 0, incomeTax: 0, creditsAmount: 0, niEmployee: 0, health: 0, pensionEmployee: 0 };

  if (!emp.hasForm101 || (!emp.isMainEmployer && !input.taxSettings.override)) {
    method = "max_rate";
    creditLines = [];
    incomeTax = round2(taxable.times(sec2.payload.maxRate));
    beforeCredits = incomeTax;
    messages.push({ level: "WARNING", code: "MAX_TAX", text: !emp.hasForm101
      ? "לא נמסר טופס 101 – נוכה מס בשיעור מרבי ללא נקודות זיכוי."
      : "משכורת נוספת ללא תיאום מס – נוכה מס בשיעור מרבי ללא נקודות זיכוי." });
    step("מס הכנסה", "מס בשיעור מרבי", `${fmt(taxable)} × ${pctS(sec2.payload.maxRate)}`, incomeTax, [sec2.id]);
  } else {
    const points = creditLines.reduce((a, l) => a + l.points, 0);
    cpAmount = round2(D(points).times(cpValue.payload.monthly));
    // זיכוי 35% על הפקדת העובד לפנסיה (סעיף 45א)
    if (pensionActive && pens) {
      const credRate = Math.min(pens.employeeRate, ptax.payload.maxEmployeeRateForCredit);
      const eligible = Decimal.min(pensionRes.employee, Decimal.min(pensionBase, ptax.payload.qualifyingIncomeCap).times(credRate));
      pensionCredit = round2(eligible.times(ptax.payload.creditRate));
      step("מס הכנסה", "זיכוי פנסיה (סעיף 45א)", `${pctS(ptax.payload.creditRate)} × ${pctS(credRate)} × min(${fmt(pensionBase)}, ${fmt(ptax.payload.qualifyingIncomeCap)})`, pensionCredit, [ptax.id]);
    }
    if (input.taxFacts.settlement && input.taxFacts.settlement.rate > 0) {
      const s = input.taxFacts.settlement;
      settlementCredit = round2(Decimal.min(taxable, D(s.annualIncomeCap).div(12)).times(s.rate));
      step("מס הכנסה", `זיכוי יישוב מזכה${s.name ? ` (${s.name})` : ""}`, `${pctS(s.rate)} × min(${fmt(taxable)}, ${fmt(s.annualIncomeCap)} ÷ 12)`, settlementCredit);
    }
    const credits = cpAmount.plus(pensionCredit).plus(settlementCredit);

    if (input.taxSettings.override) {
      method = "override";
      const o = input.taxSettings.override;
      beforeCredits = round2(taxable.times(o.rate));
      incomeTax = Decimal.max(ZERO, beforeCredits.minus(o.applyCredits ? credits : 0));
      step("מס הכנסה", `שיעור לפי תיאום מס${o.note ? ` (${o.note})` : ""}`, `${fmt(taxable)} × ${pctS(o.rate)}${o.applyCredits ? ` − זיכויים ${fmt(credits)}` : ""}`, incomeTax);
    } else if (method === "cumulative") {
      const months = ytdIn.months + 1;
      const cumTaxable = taxable.plus(ytdIn.taxableIncome);
      const bt = bracketTax(cumTaxable, brackets.payload.monthly, months);
      beforeCredits = bt.tax;
      const cumCredits = credits.plus(ytdIn.creditsAmount);
      const cumTax = Decimal.max(ZERO, bt.tax.minus(cumCredits));
      incomeTax = round2(cumTax.minus(ytdIn.incomeTax));
      step("מס הכנסה", "מס מצטבר לפי מדרגות", bt.parts.map((p) => `${fmt(p.taxable)}×${pctS(p.rate)}`).join(" + ") + ` (מדרגות × ${months} חודשים, הכנסה מצטברת ${fmt(cumTaxable)})`, bt.tax, [brackets.id]);
      step("מס הכנסה", "מס לחודש זה", `max(0, ${fmt(bt.tax)} − זיכויים מצטברים ${fmt(cumCredits)}) − מס שנוכה עד כה ${fmt(ytdIn.incomeTax)}`, incomeTax);
      if (incomeTax.lt(0)) messages.push({ level: "INFO", code: "TAX_REFUND", text: "בשיטה המצטברת נוצר החזר מס לעובד בחודש זה." });
    } else {
      const bt = bracketTax(taxable, brackets.payload.monthly, 1);
      beforeCredits = bt.tax;
      incomeTax = Decimal.max(ZERO, bt.tax.minus(credits));
      step("מס הכנסה", "מס לפי מדרגות", bt.parts.map((p) => `${fmt(p.taxable)}×${pctS(p.rate)}=${fmt(p.tax)}`).join(" + "), bt.tax, [brackets.id]);
      step("מס הכנסה", "מס לתשלום", `max(0, ${fmt(bt.tax)} − נקודות ${fmt(cpAmount)} − פנסיה ${fmt(pensionCredit)}${settlementCredit.gt(0) ? ` − יישוב ${fmt(settlementCredit)}` : ""})`, incomeTax);
    }
    step("מס הכנסה", "נקודות זיכוי", `${creditLines.map((l) => `${l.label} ${l.points}`).join(" + ") || "0"} = ${points} × ${cpValue.payload.monthly}`, cpAmount, [cpValue.id]);
  }
  const creditPoints = creditLines.reduce((a, l) => a + l.points, 0);
  add(CORE.INCOME_TAX, incomeTax);

  // ───── 10. ביטוח לאומי ובריאות ─────
  const ni = rule("national_insurance.rates");
  const niP = ni.payload;
  const niBase = Decimal.min(niBaseRaw, niP.ceiling);
  const niEmp = twoTier(niBaseRaw, niP.reducedThreshold, niP.ceiling, niP.employee.low, niP.employee.high);
  const health = twoTier(niBaseRaw, niP.reducedThreshold, niP.ceiling, niP.health.low, niP.health.high);
  const niEr = twoTier(niBaseRaw, niP.reducedThreshold, niP.ceiling, niP.employer.low, niP.employer.high);
  add(CORE.NI, niEmp.amount);
  add(CORE.HEALTH, health.amount);
  add(CORE.ER_NI, niEr.amount);
  const tierF = (low: number, high: number) => `${fmt(niEmp.lowPart)} × ${pctS(low)}` + (niEmp.highPart.gt(0) ? ` + ${fmt(niEmp.highPart)} × ${pctS(high)}` : "");
  step("ביטוח לאומי", "ביטוח לאומי עובד", tierF(niP.employee.low, niP.employee.high) + (niBaseRaw.gt(niP.ceiling) ? ` (תקרה ${fmt(niP.ceiling)})` : ""), niEmp.amount, [ni.id]);
  step("ביטוח לאומי", "מס בריאות", tierF(niP.health.low, niP.health.high), health.amount, [ni.id]);
  step("ביטוח לאומי", "ביטוח לאומי מעסיק", tierF(niP.employer.low, niP.employer.high), niEr.amount, [ni.id]);
  if (age !== null && (age < 18 || age >= (input.employee.gender === "male" ? 67 : 62)))
    messages.push({ level: "WARNING", code: "NI_SPECIAL_AGE", text: `גיל העובד ${age}: לנוער ולגיל פרישה חלים שיעורי ביטוח לאומי מיוחדים שאינם ממודלים – יש לבדוק ידנית.` });

  // ───── 11. סיכומים ─────
  const of = (c: PayslipLine["category"]) => sum(lines.filter((l) => l.category === c).map((l) => l.value));
  const mandatory = of("mandatory");
  const provident = of("provident");
  const voluntary = of("voluntary");
  const reimb = of("reimbursement");
  const net = grossPay.plus(reimb).minus(mandatory).minus(provident);
  const netToPay = net.minus(voluntary);
  const employerCost = grossPay.plus(reimb).plus(of("employer"));
  step("נטו", "נטו", `ברוטו ${fmt(grossPay)}${reimb.gt(0) ? ` + החזרים ${fmt(reimb)}` : ""} − ניכויי חובה ${fmt(mandatory)} − קופות ${fmt(provident)}`, net);
  if (voluntary.gt(0)) step("נטו", "נטו לתשלום", `${fmt(net)} − ניכויי רשות ${fmt(voluntary)}`, netToPay);
  step("עלות מעסיק", "עלות מעסיק", `ברוטו ${fmt(grossPay)} + הפרשות מעסיק ${fmt(of("employer"))}${reimb.gt(0) ? ` + החזרים ${fmt(reimb)}` : ""}`, employerCost);
  if (netToPay.lt(0)) messages.push({ level: "ERROR", code: "NEGATIVE_NET", text: "הנטו לתשלום שלילי – יש לבדוק את הניכויים." });

  // ───── 12. שכר מינימום ─────
  const mw = minWage.payload;
  let mwPct = 1;
  if (age !== null && age < 18) mwPct = Object.entries(mw.youthPct).find(([k]) => { const [a, b] = k.split("-").map(Number); return b === undefined ? age === a : age >= a && age <= b; })?.[1] ?? 1;
  const minMonthly = D(mw.monthly).times(mwPct), minHourly = D(mw.hourly).times(mwPct);
  if (emp.payType === "monthly") {
    const comparable = D(emp.baseSalary!).plus(sum((input.components ?? []).filter((c) => ["COMMISSION", "FIXED_SUPPLEMENT"].includes(c.type)).map(componentAmount))).div(jobPct);
    if (comparable.lt(minMonthly.minus(0.005)))
      messages.push({ level: "WARNING", code: "MIN_WAGE", text: `השכר (${fmt(comparable)} למשרה מלאה) נמוך משכר המינימום ${fmt(minMonthly)} ₪.` });
  } else if (hourValue.lt(minHourly.minus(0.005))) {
    messages.push({ level: "WARNING", code: "MIN_WAGE", text: `ערך השעה (${fmt(hourValue)}) נמוך משכר המינימום לשעה ${fmt(minHourly)} ₪.` });
  }

  // ───── 13. יתרות ─────
  const vacRule = rule("vacation.accrual");
  const vRow = [...vacRule.payload.table].reverse().find((r) => seniorityYear >= r.fromYear)!;
  const vAnnual = emp.workWeekDays === 5 ? vRow.days5 : vRow.days6;
  const vAccrued = D(vAnnual).div(12).times(jobPct).times(monthFraction).toDecimalPlaces(2);
  const sAccrued = D(sick.payload.accrualPerMonth).times(monthFraction).toDecimalPlaces(2);
  const bal = (opening: number, accrued: Decimal, usedDays: number, cap?: number): BalanceResult => {
    let closing = D(opening).plus(accrued).minus(usedDays);
    if (cap !== undefined) closing = Decimal.min(closing, cap);
    return { opening, accrued: accrued.toNumber(), used: usedDays, closing: closing.toDecimalPlaces(2).toNumber() };
  };
  const vacation = bal(input.balances?.vacationOpening ?? 0, vAccrued, att.vacationDays ?? 0);
  const sickBal = bal(input.balances?.sickOpening ?? 0, sAccrued, sickDaysTotal, sick.payload.maxDays);
  step("יתרות", "צבירת חופשה", `${vAnnual} ימים בשנה (שנת ותק ${seniorityYear}, שבוע ${emp.workWeekDays} ימים) ÷ 12 × היקף משרה`, vAccrued, [vacRule.id]);
  step("יתרות", "צבירת מחלה", `${sick.payload.accrualPerMonth} ימים לחודש (עד ${sick.payload.maxDays})`, sAccrued, [sick.id]);
  if (vacation.closing < 0) messages.push({ level: "WARNING", code: "VACATION_NEGATIVE", text: "יתרת החופשה שלילית." });
  if (sickBal.closing < 0) messages.push({ level: "WARNING", code: "SICK_NEGATIVE", text: "יתרת ימי המחלה שלילית – ימי מחלה מעבר ליתרה אינם משולמים." });

  // ───── 14. כללים לא מאומתים ─────
  const rulesUsed = [...used].map((id) => rules.all().find((r) => r.id === id)!).filter(Boolean).map((r) => ({
    id: r.id, key: r.key, version: r.version, verified: r.verified, source: r.source.name,
  }));
  for (const r of rulesUsed.filter((r) => !r.verified))
    messages.push({ level: "WARNING", code: "UNVERIFIED_RULE", text: `נעשה שימוש בכלל שלא אומת מול מקור רשמי: ${r.key} (גרסה ${r.version}).` });
  messages.push({ level: "INFO", code: "RULES_DATE", text: `כללים לפי תאריך ${start}.` });

  const out = (l: Line): PayslipLine => {
    const { def: _d, value: _v, ...rest } = l;
    void _d; void _v;
    return rest;
  };

  const ytd = {
    months: ytdIn.months + 1,
    gross: toMoney(D(ytdIn.gross).plus(grossPay)),
    taxableIncome: toMoney(D(ytdIn.taxableIncome).plus(taxable)),
    incomeTax: toMoney(D(ytdIn.incomeTax).plus(incomeTax)),
    creditsAmount: toMoney(D(ytdIn.creditsAmount).plus(cpAmount).plus(pensionCredit).plus(settlementCredit)),
    niEmployee: toMoney(D(ytdIn.niEmployee).plus(niEmp.amount)),
    health: toMoney(D(ytdIn.health).plus(health.amount)),
    pensionEmployee: toMoney(D(ytdIn.pensionEmployee).plus(pensionRes.employee)),
  };

  return {
    period,
    lines: lines.map(out),
    bases: { tax: toMoney(taxable), ni: toMoney(niBase), pension: toMoney(pensionBase), studyFund: sfRes.base, overtimeHourValue: toMoney(otHourValue) },
    tax: {
      method, beforeCredits: toMoney(beforeCredits), creditPoints, creditPointsBreakdown: creditLines,
      creditPointsAmount: toMoney(cpAmount), pensionCredit: toMoney(pensionCredit), settlementCredit: toMoney(settlementCredit),
      incomeTax: toMoney(incomeTax), marginalRate: method === "max_rate" ? sec2.payload.maxRate : marginalRate(taxable, brackets.payload.monthly),
    },
    ni: { base: toMoney(niBase), employee: toMoney(niEmp.amount), health: toMoney(health.amount), employer: toMoney(niEr.amount) },
    pension: { base: pensionRes.base, employee: toMoney(pensionRes.employee), employer: toMoney(pensionRes.employer), disability: toMoney(pensionRes.disability), severance: toMoney(pensionRes.severance), active: pensionActive },
    studyFund: { base: sfRes.base, employee: toMoney(sfRes.employee), employer: toMoney(sfRes.employer), imputed: toMoney(sfRes.imputed), active: sfRes.active },
    totals: {
      grossPay: toMoney(grossPay), benefits: toMoney(of("benefit")), reimbursements: toMoney(reimb),
      mandatoryDeductions: toMoney(mandatory), providentDeductions: toMoney(provident), voluntaryDeductions: toMoney(voluntary),
      totalDeductions: toMoney(mandatory.plus(provident).plus(voluntary)), net: toMoney(net), netToPay: toMoney(netToPay), employerCost: toMoney(employerCost),
    },
    balances: { vacation, sick: sickBal },
    info: {
      ageYears: age, seniorityMonths, seniorityYears: +(seniorityMonths / 12).toFixed(2),
      hourValue: toMoney(hourValue), dayValue: toMoney(dayValue), recoveryEntitlementDays: seniorityMonths >= 12 ? recDays : 0,
      minWageMonthly: toMoney(minMonthly), minWageHourly: toMoney(minHourly),
    },
    ytd,
    trace,
    messages,
    rulesUsed,
  };
}

function componentAmount(c: { amount?: number; quantity?: number; rate?: number }) {
  if (c.quantity !== undefined && c.rate !== undefined && c.amount === undefined) return D(c.quantity).times(c.rate);
  return D(c.amount ?? 0);
}

export class PayrollValidationError extends Error {
  constructor(public messages: Message[]) {
    super(messages.filter((m) => m.level === "ERROR").map((m) => m.text).join(" | "));
  }
}

/** בדיקות לפני חישוב – הודעות מדויקות במקום "שגיאה כללית" */
export function validate(input: PayrollInput, messages: Message[] = []) {
  const e = (code: string, text: string) => messages.push({ level: "ERROR", code, text });
  const w = (code: string, text: string) => messages.push({ level: "WARNING", code, text });
  const { period, employment: emp, attendance: att } = input;
  if (!(period.month >= 1 && period.month <= 12) || !(period.year >= 2000 && period.year <= 2100)) e("PERIOD", "תקופת שכר לא תקינה.");
  if (!isValidDate(emp.startDate)) e("START_DATE", "חסר תאריך תחילת עבודה.");
  else if (emp.startDate > periodEnd(period.year, period.month)) e("NOT_STARTED", "העובד התחיל לעבוד אחרי תקופת השכר.");
  if (emp.endDate && isValidDate(emp.endDate) && emp.endDate < periodStart(period.year, period.month)) e("ENDED", "ההעסקה הסתיימה לפני תקופת השכר.");
  if (!(emp.jobPercent > 0 && emp.jobPercent <= 100)) e("JOB_PERCENT", "היקף משרה חייב להיות בין 1 ל-100.");
  if (emp.payType === "monthly" && !(Number(emp.baseSalary) > 0)) e("BASE_SALARY", "חסר שכר בסיס חודשי.");
  if (emp.payType === "hourly" && !(Number(emp.hourlyRate) > 0)) e("HOURLY_RATE", "חסר תעריף שעתי.");
  if (emp.payType === "daily" && !(Number(emp.dailyRate) > 0)) e("DAILY_RATE", "חסר תעריף יומי.");
  if (emp.payType === "hourly" && !att.regularHours) w("NO_HOURS", "לא הוזנו שעות רגילות לעובד שעתי.");
  if (att.workDays < 0 || att.workDays > 31) e("WORK_DAYS", "מספר ימי עבודה לא תקין.");
  if (!input.employee.birthDate) w("NO_BIRTHDATE", "חסר תאריך לידה – לא ניתן לבדוק שכר מינימום לנוער וגיל פרישה.");
  if (input.pension?.enabled && input.pension.startDate && !isValidDate(input.pension.startDate)) e("PENSION_START", "תאריך תחילת זכאות לפנסיה לא תקין.");
  for (const c of input.taxFacts.children ?? []) if (!isValidDate(c.birthDate)) e("CHILD_BIRTHDATE", "תאריך לידה של ילד לא תקין.");
  const absences = (att.vacationDays ?? 0) + (att.unpaidDays ?? 0) + (att.sickEpisodes ?? []).reduce((a, s) => a + s.days, 0);
  if (absences + att.workDays > 31) w("DAYS_OVERFLOW", "סך ימי העבודה וההיעדרויות עולה על מספר הימים בחודש.");
  return messages;
}
