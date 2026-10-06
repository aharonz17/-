"use server";
import { runAction } from "@/lib/action";
import { bool, date, num, num0, pct, reqStr, str, validIsraeliId } from "@/lib/form";
import {
  currentEmployment, getEmployee, getTaxProfile, saveEmployee, saveEmployment, saveTaxProfile,
  type EmploymentInput, type EmployeeInput,
} from "@/server/repo";
import { audit } from "@/server/audit";
import { getDb } from "@/server/db";
import { normalizeBankCode, validateIban } from "@/domain/bank/banks";
import { EXTRA_TYPES } from "@/domain/payroll/catalog";
import type { ExtraComponent, ExtraComponentType, TaxFacts } from "@/domain/payroll/types";
import type { TaxProfile } from "@/server/repo";

function readPersonal(fd: FormData, withEmployer: boolean): EmployeeInput {
  const idNumber = reqStr(fd, "id_number", "מספר זהות").replace(/\D/g, "");
  if (!validIsraeliId(idNumber)) throw new Error("מספר הזהות אינו תקין (ספרת ביקורת).");
  const iban = str(fd, "iban");
  if (iban && !validateIban(iban)) throw new Error("ה-IBAN אינו תקין.");
  const data: EmployeeInput = {
    first_name: reqStr(fd, "first_name", "שם פרטי"),
    last_name: reqStr(fd, "last_name", "שם משפחה"),
    id_number: idNumber.padStart(9, "0"),
    employee_number: str(fd, "employee_number"),
    birth_date: date(fd, "birth_date"),
    gender: str(fd, "gender") === "female" ? "female" : "male",
    marital_status: str(fd, "marital_status"),
    status: str(fd, "status") ?? "ACTIVE",
    address: str(fd, "address"), city: str(fd, "city"), zip: str(fd, "zip"), phone: str(fd, "phone"), email: str(fd, "email"),
    payment_method: str(fd, "payment_method") ?? "BANK",
    bank_code: str(fd, "bank_code") ? normalizeBankCode(str(fd, "bank_code")) : null,
    branch: str(fd, "branch"), account: str(fd, "account"), account_holder: str(fd, "account_holder"), iban: iban?.replace(/\s/g, "").toUpperCase() ?? null,
  };
  if (withEmployer) {
    const emp = num(fd, "employer_id");
    if (!emp) throw new Error("יש לבחור מעסיק.");
    data.employer_id = emp;
  }
  return data;
}

function readEmployment(fd: FormData): EmploymentInput {
  const payType = (str(fd, "pay_type") ?? "monthly") as "monthly" | "hourly" | "daily";
  const fixed: ExtraComponent[] = [];
  for (let i = 0; i < num0(fd, "fc_count"); i++) {
    const type = str(fd, `fc_type_${i}`);
    const amount = num(fd, `fc_amount_${i}`);
    if (type && EXTRA_TYPES.includes(type as ExtraComponentType) && amount) fixed.push({ type: type as ExtraComponentType, description: str(fd, `fc_desc_${i}`) ?? undefined, amount });
  }
  const carPrice = num(fd, "car_price");
  const phoneCost = num(fd, "phone_cost");
  const daily = num(fd, "travel_daily");
  return {
    start_date: date(fd, "start_date") ?? (() => { throw new Error("חסר תאריך תחילת עבודה."); })(),
    end_date: date(fd, "end_date"),
    role: str(fd, "role"), department: str(fd, "department"),
    pay_type: payType,
    base_salary: num(fd, "base_salary"), hourly_rate: num(fd, "hourly_rate"), daily_rate: num(fd, "daily_rate"),
    job_percent: num(fd, "job_percent") ?? 100,
    work_week_days: num(fd, "work_week_days") === 6 ? 6 : 5,
    standard_hours: num(fd, "standard_hours"),
    is_main_employer: bool(fd, "is_main_employer") ? 1 : 0,
    has_form_101: bool(fd, "has_form_101") ? 1 : 0,
    prior_seniority_months: num0(fd, "prior_seniority_months"),
    vacation_opening: num0(fd, "vacation_opening"),
    sick_opening: num0(fd, "sick_opening"),
    settings: {
      taxMethod: str(fd, "tax_method") === "cumulative" ? "cumulative" : "monthly",
      pension: {
        enabled: bool(fd, "pension_enabled"),
        employeeRate: pct(fd, "pension_employee") ?? 0.06, employerRate: pct(fd, "pension_employer") ?? 0.065,
        severanceRate: pct(fd, "pension_severance") ?? 0.06, disabilityRate: pct(fd, "pension_disability") ?? 0,
        startDate: date(fd, "pension_start"), hasExistingFund: bool(fd, "pension_existing"),
        provider: str(fd, "pension_provider") ?? undefined, product: str(fd, "pension_product") ?? undefined,
      },
      studyFund: bool(fd, "sf_enabled") ? {
        enabled: true, employeeRate: pct(fd, "sf_employee") ?? 0.025, employerRate: pct(fd, "sf_employer") ?? 0.075, capAtCeiling: str(fd, "sf_cap") !== "full",
      } : null,
      travel: daily ? { dailyFare: daily, monthlyPass: num(fd, "travel_monthly") } : null,
      recovery: { mode: str(fd, "recovery_mode") === "monthly" ? "monthly" : "none" },
      car: carPrice ? { listPrice: carPrice, kind: (str(fd, "car_kind") ?? "regular") as "regular", employeeContribution: num(fd, "car_employee") ?? undefined } : null,
      phone: phoneCost ? { monthlyCost: phoneCost, employeePaid: num(fd, "phone_paid") ?? undefined } : null,
      fixedComponents: fixed,
    },
  };
}

function readTax(fd: FormData): { year: number; facts: TaxFacts; settings: TaxProfile["settings"] } {
  const year = num(fd, "tax_year")!;
  const children = [];
  for (let i = 0; i < num0(fd, "child_count"); i++) {
    const d = date(fd, `child_${i}`);
    if (d) children.push({ birthDate: d, disabled: bool(fd, `child_dis_${i}`) || undefined });
  }
  const discharge = date(fd, "discharge_date");
  const degreeType = str(fd, "degree_type");
  const aliyah = date(fd, "aliyah_date");
  const sRate = pct(fd, "settlement_rate");
  const oRate = pct(fd, "override_rate");
  return {
    year,
    facts: {
      resident: bool(fd, "resident"),
      singleParent: bool(fd, "single_parent") || undefined,
      alimonyOrRemarriage: bool(fd, "alimony") || undefined,
      children,
      dischargedSoldier: discharge ? { dischargeDate: discharge, serviceMonths: num0(fd, "service_months") } : null,
      degree: degreeType ? { type: degreeType as "bachelor" | "master", completionYear: num(fd, "degree_year") ?? year - 1 } : null,
      newImmigrant: aliyah ? { aliyahDate: aliyah } : null,
      reserveCombatDaysPrevYear: num(fd, "reserve_days") ?? undefined,
      settlement: sRate ? { name: str(fd, "settlement_name") ?? undefined, rate: sRate, annualIncomeCap: num0(fd, "settlement_cap") } : null,
      creditPointsOverride: num(fd, "points_override"),
      additionalPoints: num(fd, "additional_points") ?? undefined,
      additionalPointsNote: str(fd, "additional_note") ?? undefined,
    },
    settings: { override: oRate !== null ? { rate: oRate, applyCredits: bool(fd, "override_credits"), note: str(fd, "override_note") ?? undefined } : null },
  };
}

export async function createEmployeeAction(fd: FormData) {
  await runAction("/employees/new", (actor) => {
    const personal = readPersonal(fd, true);
    const employment = readEmployment(fd);
    const tax = readTax(fd);
    const id = getDb().transaction(() => {
      const id = saveEmployee(personal);
      saveEmployment(id, employment);
      saveTaxProfile(id, tax.year, tax.facts, tax.settings);
      return id;
    })();
    audit({ entityType: "employee", entityId: id, action: "CREATE", actor, newValue: { ...personal, employment, tax } });
    return { to: `/employees/${id}`, ok: "העובד נוצר" };
  });
}

export async function updatePersonalAction(id: number, fd: FormData) {
  await runAction(`/employees/${id}`, (actor) => {
    const old = getEmployee(id);
    const data = readPersonal(fd, false);
    saveEmployee(data, id);
    audit({ entityType: "employee", entityId: id, action: "UPDATE", actor, oldValue: old, newValue: data });
    return { ok: "הפרטים נשמרו" };
  });
}

export async function updateEmploymentAction(employeeId: number, employmentId: number | null, fd: FormData) {
  await runAction(`/employees/${employeeId}?tab=employment`, (actor) => {
    const old = currentEmployment(employeeId);
    const data = readEmployment(fd);
    saveEmployment(employeeId, data, employmentId ?? undefined);
    audit({ entityType: "employment", entityId: employeeId, action: "UPDATE", actor, oldValue: old, newValue: data });
    return { ok: "פרטי ההעסקה נשמרו" };
  });
}

export async function saveTaxAction(employeeId: number, fd: FormData) {
  const year = Number(fd.get("tax_year"));
  await runAction(`/employees/${employeeId}?tab=tax&year=${year}`, (actor) => {
    const t = readTax(fd);
    const old = getTaxProfile(employeeId, t.year);
    saveTaxProfile(employeeId, t.year, t.facts, t.settings);
    audit({ entityType: "tax_profile", entityId: `${employeeId}/${t.year}`, action: old ? "UPDATE" : "CREATE", actor, oldValue: old, newValue: t });
    return { ok: `פרופיל המס לשנת ${t.year} נשמר` };
  });
}
