import { BANKS } from "@/domain/bank/banks";
import { EXTRA, EXTRA_TYPES } from "@/domain/payroll/catalog";
import type { Employee, Employment, Employer, TaxProfile } from "@/server/repo";
import { F } from "@/components/ui";

const pctIn = (v: number | null | undefined) => (v === null || v === undefined ? "" : +(v * 100).toFixed(4));

export function PersonalFields({ e, employers, employerId }: { e?: Employee; employers?: Employer[]; employerId?: number }) {
  return (
    <>
      <fieldset>
        <legend>פרטים אישיים</legend>
        <div className="fields">
          {employers && (
            <F label="מעסיק *">
              <select name="employer_id" required defaultValue={e?.employer_id ?? employerId ?? ""}>
                <option value="">בחרו…</option>
                {employers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </F>
          )}
          <F label="שם פרטי *"><input name="first_name" required defaultValue={e?.first_name} /></F>
          <F label="שם משפחה *"><input name="last_name" required defaultValue={e?.last_name} /></F>
          <F label="מספר זהות *"><input name="id_number" required defaultValue={e?.id_number} inputMode="numeric" maxLength={9} /></F>
          <F label="מספר עובד"><input name="employee_number" defaultValue={e?.employee_number ?? ""} /></F>
          <F label="תאריך לידה"><input type="date" name="birth_date" defaultValue={e?.birth_date ?? ""} /></F>
          <F label="מגדר *">
            <select name="gender" defaultValue={e?.gender ?? "male"}><option value="male">גבר</option><option value="female">אישה</option></select>
          </F>
          <F label="מצב משפחתי">
            <select name="marital_status" defaultValue={e?.marital_status ?? ""}>
              <option value="">—</option><option value="single">רווק/ה</option><option value="married">נשוי/אה</option>
              <option value="divorced">גרוש/ה</option><option value="widowed">אלמן/ה</option><option value="separated">פרוד/ה</option>
            </select>
          </F>
          <F label="סטטוס">
            <select name="status" defaultValue={e?.status ?? "ACTIVE"}><option value="ACTIVE">פעיל</option><option value="INACTIVE">לא פעיל</option></select>
          </F>
          <F label="כתובת"><input name="address" defaultValue={e?.address ?? ""} /></F>
          <F label="עיר"><input name="city" defaultValue={e?.city ?? ""} /></F>
          <F label="מיקוד"><input name="zip" defaultValue={e?.zip ?? ""} /></F>
          <F label="טלפון"><input name="phone" defaultValue={e?.phone ?? ""} /></F>
          <F label="דוא״ל"><input name="email" type="email" defaultValue={e?.email ?? ""} /></F>
        </div>
      </fieldset>
      <fieldset>
        <legend>פרטי תשלום</legend>
        <div className="fields">
          <F label="אמצעי תשלום">
            <select name="payment_method" defaultValue={e?.payment_method ?? "BANK"}><option value="BANK">העברה בנקאית</option><option value="CHECK">שיק</option><option value="CASH">מזומן</option></select>
          </F>
          <F label="בנק">
            <select name="bank_code" defaultValue={e?.bank_code ?? ""}>
              <option value="">—</option>
              {BANKS.filter((b) => b.active).map((b) => <option key={b.code} value={b.code}>{b.code} – {b.name}</option>)}
            </select>
          </F>
          <F label="סניף"><input name="branch" defaultValue={e?.branch ?? ""} inputMode="numeric" /></F>
          <F label="מספר חשבון"><input name="account" defaultValue={e?.account ?? ""} inputMode="numeric" /></F>
          <F label="שם בעל החשבון"><input name="account_holder" defaultValue={e?.account_holder ?? ""} /></F>
          <F label="IBAN"><input name="iban" defaultValue={e?.iban ?? ""} className="ltr" placeholder="IL…" /></F>
        </div>
      </fieldset>
    </>
  );
}

export function EmploymentFields({ m }: { m?: Employment }) {
  const s = m?.settings ?? {};
  const fixed = [...(s.fixedComponents ?? []), {}, {}] as { type?: string; description?: string; amount?: number }[];
  return (
    <>
      <fieldset>
        <legend>העסקה ושכר</legend>
        <div className="fields">
          <F label="תאריך תחילת עבודה *"><input type="date" name="start_date" required defaultValue={m?.start_date ?? ""} /></F>
          <F label="תאריך סיום"><input type="date" name="end_date" defaultValue={m?.end_date ?? ""} /></F>
          <F label="תפקיד"><input name="role" defaultValue={m?.role ?? ""} /></F>
          <F label="מחלקה"><input name="department" defaultValue={m?.department ?? ""} /></F>
          <F label="סוג שכר *">
            <select name="pay_type" defaultValue={m?.pay_type ?? "monthly"}><option value="monthly">חודשי</option><option value="hourly">שעתי</option><option value="daily">יומי</option></select>
          </F>
          <F label="שכר בסיס חודשי (₪)"><input name="base_salary" inputMode="decimal" defaultValue={m?.base_salary ?? ""} /></F>
          <F label="תעריף לשעה (₪)"><input name="hourly_rate" inputMode="decimal" defaultValue={m?.hourly_rate ?? ""} /></F>
          <F label="תעריף ליום (₪)"><input name="daily_rate" inputMode="decimal" defaultValue={m?.daily_rate ?? ""} /></F>
          <F label="היקף משרה (%) *"><input name="job_percent" inputMode="decimal" required defaultValue={m?.job_percent ?? 100} /></F>
          <F label="ימי עבודה בשבוע">
            <select name="work_week_days" defaultValue={m?.work_week_days ?? 5}><option value={5}>5</option><option value={6}>6</option></select>
          </F>
          <F label="שעות תקן חודשיות (ריק = 182)"><input name="standard_hours" inputMode="decimal" defaultValue={m?.standard_hours ?? ""} /></F>
          <F label="ותק קודם מוכר (חודשים)"><input name="prior_seniority_months" inputMode="numeric" defaultValue={m?.prior_seniority_months ?? 0} /></F>
        </div>
        <div className="fields" style={{ marginTop: "0.75rem" }}>
          <label className="check"><input type="checkbox" name="has_form_101" defaultChecked={m ? !!m.has_form_101 : true} /> נמסר טופס 101</label>
          <label className="check"><input type="checkbox" name="is_main_employer" defaultChecked={m ? !!m.is_main_employer : true} /> משכורת עיקרית</label>
          <F label="שיטת חישוב מס">
            <select name="tax_method" defaultValue={s.taxMethod ?? "monthly"}><option value="monthly">חודשית</option><option value="cumulative">מצטברת</option></select>
          </F>
        </div>
      </fieldset>

      <fieldset>
        <legend>פנסיה</legend>
        <div className="fields">
          <label className="check"><input type="checkbox" name="pension_enabled" defaultChecked={s.pension ? s.pension.enabled : true} /> מפרישים לפנסיה</label>
          <F label="עובד (%)"><input name="pension_employee" inputMode="decimal" defaultValue={pctIn(s.pension?.employeeRate ?? 0.06)} /></F>
          <F label="מעסיק – תגמולים (%)"><input name="pension_employer" inputMode="decimal" defaultValue={pctIn(s.pension?.employerRate ?? 0.065)} /></F>
          <F label="פיצויים (%)"><input name="pension_severance" inputMode="decimal" defaultValue={pctIn(s.pension?.severanceRate ?? 0.06)} /></F>
          <F label="אובדן כושר – מעסיק (%)"><input name="pension_disability" inputMode="decimal" defaultValue={pctIn(s.pension?.disabilityRate ?? 0)} /></F>
          <F label="תאריך תחילת הפרשה (ריק = לפי תקופת המתנה)"><input type="date" name="pension_start" defaultValue={s.pension?.startDate ?? ""} /></F>
          <label className="check"><input type="checkbox" name="pension_existing" defaultChecked={!!s.pension?.hasExistingFund} /> לעובד יש קופה קיימת</label>
          <F label="גוף מוסדי"><input name="pension_provider" defaultValue={s.pension?.provider ?? ""} /></F>
          <F label="מוצר / מספר פוליסה"><input name="pension_product" defaultValue={s.pension?.product ?? ""} /></F>
        </div>
      </fieldset>

      <fieldset>
        <legend>קרן השתלמות</legend>
        <div className="fields">
          <label className="check"><input type="checkbox" name="sf_enabled" defaultChecked={!!s.studyFund?.enabled} /> יש קרן השתלמות</label>
          <F label="עובד (%)"><input name="sf_employee" inputMode="decimal" defaultValue={pctIn(s.studyFund?.employeeRate ?? 0.025)} /></F>
          <F label="מעסיק (%)"><input name="sf_employer" inputMode="decimal" defaultValue={pctIn(s.studyFund?.employerRate ?? 0.075)} /></F>
          <F label="בסיס ההפרשה">
            <select name="sf_cap" defaultValue={s.studyFund?.capAtCeiling === false ? "full" : "cap"}>
              <option value="cap">עד תקרת הפטור</option><option value="full">על מלוא השכר (העודף נזקף)</option>
            </select>
          </F>
        </div>
      </fieldset>

      <fieldset>
        <legend>הטבות, נסיעות והבראה</legend>
        <div className="fields">
          <F label="נסיעה יומית (₪)"><input name="travel_daily" inputMode="decimal" defaultValue={s.travel?.dailyFare ?? ""} /></F>
          <F label="חופשי חודשי (₪, אופציונלי)"><input name="travel_monthly" inputMode="decimal" defaultValue={s.travel?.monthlyPass ?? ""} /></F>
          <F label="דמי הבראה">
            <select name="recovery_mode" defaultValue={s.recovery?.mode ?? "none"}>
              <option value="none">לא חודשי (תשלום ידני בהרצה)</option><option value="monthly">חלק חודשי (1/12)</option>
            </select>
          </F>
          <F label="רכב – מחיר מחירון (₪)"><input name="car_price" inputMode="decimal" defaultValue={s.car?.listPrice ?? ""} /></F>
          <F label="סוג רכב">
            <select name="car_kind" defaultValue={s.car?.kind ?? "regular"}>
              <option value="regular">רגיל</option><option value="hybrid">היברידי</option><option value="plugin">פלאג-אין</option><option value="electric">חשמלי</option>
            </select>
          </F>
          <F label="השתתפות עובד ברכב (₪)"><input name="car_employee" inputMode="decimal" defaultValue={s.car?.employeeContribution ?? ""} /></F>
          <F label="טלפון נייד – עלות חודשית (₪)"><input name="phone_cost" inputMode="decimal" defaultValue={s.phone?.monthlyCost ?? ""} /></F>
          <F label="טלפון – תשלום עובד (₪)"><input name="phone_paid" inputMode="decimal" defaultValue={s.phone?.employeePaid ?? ""} /></F>
        </div>
      </fieldset>

      <fieldset>
        <legend>רכיבים קבועים כל חודש</legend>
        <p className="muted small">למשל תוספת קבועה, שעות נוספות גלובליות, דמי ועד או החזר הלוואה חודשי.</p>
        {fixed.map((c, i) => (
          <div className="fields" key={i} style={{ marginBottom: "0.5rem" }}>
            <F label="סוג">
              <select name={`fc_type_${i}`} defaultValue={c.type ?? ""}>
                <option value="">—</option>
                {EXTRA_TYPES.map((t) => <option key={t} value={t}>{EXTRA[t].name}</option>)}
              </select>
            </F>
            <F label="תיאור"><input name={`fc_desc_${i}`} defaultValue={c.description ?? ""} /></F>
            <F label="סכום (₪)"><input name={`fc_amount_${i}`} inputMode="decimal" defaultValue={c.amount ?? ""} /></F>
          </div>
        ))}
        <input type="hidden" name="fc_count" value={fixed.length} />
      </fieldset>

      <fieldset>
        <legend>יתרות פתיחה (לפני התלוש הראשון במערכת)</legend>
        <div className="fields">
          <F label="יתרת חופשה (ימים)"><input name="vacation_opening" inputMode="decimal" defaultValue={m?.vacation_opening ?? 0} /></F>
          <F label="יתרת מחלה (ימים)"><input name="sick_opening" inputMode="decimal" defaultValue={m?.sick_opening ?? 0} /></F>
        </div>
      </fieldset>
    </>
  );
}

export function TaxFields({ t, year }: { t?: TaxProfile; year: number }) {
  const f = t?.facts ?? { resident: true };
  const kids = [...(f.children ?? []), {}, {}, {}] as { birthDate?: string; disabled?: boolean }[];
  return (
    <>
      <input type="hidden" name="tax_year" value={year} />
      <fieldset>
        <legend>נתונים לנקודות זיכוי – שנת {year}</legend>
        <div className="fields">
          <label className="check"><input type="checkbox" name="resident" defaultChecked={f.resident !== false} /> תושב/ת ישראל</label>
          <label className="check"><input type="checkbox" name="single_parent" defaultChecked={!!f.singleParent} /> הורה יחיד</label>
          <label className="check"><input type="checkbox" name="alimony" defaultChecked={!!f.alimonyOrRemarriage} /> משלם/ת מזונות / נישואין חוזרים</label>
        </div>
        <h3>ילדים</h3>
        {kids.map((k, i) => (
          <div className="fields" key={i}>
            <F label={`תאריך לידה – ילד ${i + 1}`}><input type="date" name={`child_${i}`} defaultValue={k.birthDate ?? ""} /></F>
            <label className="check"><input type="checkbox" name={`child_dis_${i}`} defaultChecked={!!k.disabled} /> ילד עם מוגבלות</label>
          </div>
        ))}
        <input type="hidden" name="child_count" value={kids.length} />
        <h3>זכאויות נוספות</h3>
        <div className="fields">
          <F label="תאריך שחרור משירות"><input type="date" name="discharge_date" defaultValue={f.dischargedSoldier?.dischargeDate ?? ""} /></F>
          <F label="חודשי שירות"><input name="service_months" inputMode="numeric" defaultValue={f.dischargedSoldier?.serviceMonths ?? ""} /></F>
          <F label="תואר">
            <select name="degree_type" defaultValue={f.degree?.type ?? ""}><option value="">—</option><option value="bachelor">ראשון</option><option value="master">שני</option></select>
          </F>
          <F label="שנת סיום התואר"><input name="degree_year" inputMode="numeric" defaultValue={f.degree?.completionYear ?? ""} /></F>
          <F label="תאריך עלייה"><input type="date" name="aliyah_date" defaultValue={f.newImmigrant?.aliyahDate ?? ""} /></F>
          <F label="ימי מילואים קרביים בשנה הקודמת"><input name="reserve_days" inputMode="numeric" defaultValue={f.reserveCombatDaysPrevYear ?? ""} /></F>
          <F label="יישוב מזכה – שם"><input name="settlement_name" defaultValue={f.settlement?.name ?? ""} /></F>
          <F label="יישוב מזכה – שיעור זיכוי (%)"><input name="settlement_rate" inputMode="decimal" defaultValue={pctIn(f.settlement?.rate)} /></F>
          <F label="יישוב מזכה – תקרת הכנסה שנתית (₪)"><input name="settlement_cap" inputMode="decimal" defaultValue={f.settlement?.annualIncomeCap ?? ""} /></F>
          <F label="נקודות זיכוי נוספות (ידני)"><input name="additional_points" inputMode="decimal" defaultValue={f.additionalPoints ?? ""} /></F>
          <F label="סיבה לנקודות הנוספות"><input name="additional_note" defaultValue={f.additionalPointsNote ?? ""} /></F>
        </div>
      </fieldset>
      <fieldset>
        <legend>תיאום מס / שיעור קבוע</legend>
        <div className="fields">
          <F label="שיעור מס לפי אישור (%) – ריק = רגיל"><input name="override_rate" inputMode="decimal" defaultValue={pctIn(t?.settings.override?.rate)} /></F>
          <label className="check"><input type="checkbox" name="override_credits" defaultChecked={t?.settings.override?.applyCredits ?? false} /> להפחית נקודות זיכוי</label>
          <F label="הערה (מספר אישור)"><input name="override_note" defaultValue={t?.settings.override?.note ?? ""} /></F>
        </div>
      </fieldset>
    </>
  );
}
