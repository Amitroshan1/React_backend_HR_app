/** Sum standard monthly allowance heads (falls back to legacy other_allowance). */
export function sumAllowanceHeads(ctc) {
  if (!ctc || typeof ctc !== "object") return 0;
  const heads =
    Number(ctc.special_allowance || 0)
    + Number(ctc.conveyance_allowance || 0)
    + Number(ctc.medical_allowance || 0)
    + Number(ctc.lta_allowance || 0);
  if (heads > 0) return heads;
  return Number(ctc.other_allowance || 0);
}

/** Fixed annual CTC from saved breakup (computed total, not the round target input). */
export function resolveAnnualCtcTotal(ctc) {
  if (!ctc || typeof ctc !== "object") return 0;

  const stored = Number(ctc.annual_ctc_computed ?? ctc.fixed_ctc_annual);
  if (Number.isFinite(stored) && stored > 0) return stored;

  const basic = Number(ctc.basic_salary || 0);
  const da = Number(ctc.dearness_allowance || 0);
  const hra = Number(ctc.hra || 0);
  const allowances = sumAllowanceHeads(ctc);
  const gross =
    basic + da > 0 ? basic + da + hra + allowances : Number(ctc.gross_salary || 0);

  if (gross <= 0) return 0;

  const total =
    gross * 12
    + Number(ctc.gratuity_yearly || 0)
    + Number(ctc.employer_pf_yearly || 0)
    + Number(ctc.pf_admin_yearly || 0)
    + Number(ctc.edli_yearly || 0)
    + Number(ctc.statutory_bonus_yearly || 0)
    + Number(ctc.lwf_employer_yearly || 0)
    + Number(ctc.employer_esic_yearly || 0)
    + Number(ctc.mediclaim_yearly || 0);

  return Math.round(total * 100) / 100;
}

export function resolveTotalCtcAnnual(ctc) {
  if (!ctc || typeof ctc !== "object") return 0;
  const stored = Number(ctc.total_ctc_annual);
  if (Number.isFinite(stored) && stored > 0) return stored;
  const fixed = resolveAnnualCtcTotal(ctc);
  const variable = Number(ctc.variable_ctc_annual || 0);
  return Math.round((fixed + variable) * 100) / 100;
}

/** Monthly earnings rows for CTC display (non-zero heads only). */
export function buildCtcEarningsRows(ctc) {
  if (!ctc) return [];
  const rows = [];
  const basic = Number(ctc.basic_salary || 0);
  const da = Number(ctc.dearness_allowance || 0);
  if (basic > 0) rows.push({ label: "Basic", value: basic });
  if (da > 0) rows.push({ label: "Dearness Allowance (DA)", value: da });
  if (basic > 0 || da > 0) {
    rows.push({
      label: "Basic + DA",
      value: basic + da,
      tone: "sub",
    });
  }
  const hra = Number(ctc.hra || 0);
  if (hra > 0) {
    rows.push({
      label: ctc.hra_pct != null ? `HRA (${Number(ctc.hra_pct)}%)` : "HRA",
      value: hra,
    });
  }
  const headDefs = [
    ["Special Allowance", ctc.special_allowance],
    ["Conveyance", ctc.conveyance_allowance],
    ["Medical Allowance", ctc.medical_allowance],
    ["LTA", ctc.lta_allowance],
  ];
  let headShown = false;
  headDefs.forEach(([label, val]) => {
    const n = Number(val || 0);
    if (n > 0) {
      rows.push({ label, value: n });
      headShown = true;
    }
  });
  if (!headShown) {
    const legacy = Number(ctc.other_allowance || 0);
    if (legacy > 0) rows.push({ label: "Other Allowance", value: legacy });
  }
  rows.push({ label: "Gross Salary", value: ctc.gross_salary, tone: "accent" });
  rows.push({ label: "Net Salary", value: ctc.net_salary, tone: "green" });
  return rows;
}

export function formatCtcRupee(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "Rs. 0.00";
  return `Rs. ${num.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
