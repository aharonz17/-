export const ils = (v: number | null | undefined) =>
  v === null || v === undefined ? "" : v.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const n2 = (v: number | null | undefined) =>
  v === null || v === undefined ? "" : v.toLocaleString("he-IL", { maximumFractionDigits: 2 });

export const pctFmt = (v: number | null | undefined) => (v === null || v === undefined ? "" : `${+(v * 100).toFixed(2)}%`);

export const dateIL = (s: string | null | undefined) => {
  if (!s) return "";
  const [y, m, d] = s.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
};

export const periodIL = (y: number, m: number) => `${String(m).padStart(2, "0")}/${y}`;

export const MONTHS = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];

export const RUN_STATUS: Record<string, { label: string; cls: string }> = {
  DRAFT: { label: "טיוטה", cls: "" },
  CALCULATED: { label: "חושב", cls: "info" },
  APPROVED: { label: "אושר ונעול", cls: "ok" },
  PAID: { label: "שולם", cls: "ok" },
  REVERSED: { label: "בוטל", cls: "err" },
};

export const PAYMENT_STATUS: Record<string, { label: string; cls: string }> = {
  PENDING: { label: "ממתין", cls: "warn" },
  SENT: { label: "נשלח", cls: "info" },
  PAID: { label: "שולם (הותאם)", cls: "ok" },
  CANCELLED: { label: "בוטל", cls: "err" },
};

export const maskAccount = (s: string | null | undefined) => (s ? (s.length > 4 ? "•••" + s.slice(-4) : s) : "");
