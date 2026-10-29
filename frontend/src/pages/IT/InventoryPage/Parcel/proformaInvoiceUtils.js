const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
  "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function chunkToWords(n) {
  if (n < 20) return ONES[n];
  if (n < 100) return `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ""}`.trim();
  return `${ONES[Math.floor(n / 100)]} Hundred${n % 100 ? ` ${chunkToWords(n % 100)}` : ""}`;
}

export function amountInWords(value) {
  const amount = Math.round(Number(value) || 0);
  if (amount <= 0) return "Zero Only.";
  if (amount > 999999999) return `${amount} Only.`;
  const crore = Math.floor(amount / 10000000);
  const lakh = Math.floor((amount % 10000000) / 100000);
  const thousand = Math.floor((amount % 100000) / 1000);
  const rest = amount % 1000;
  const parts = [];
  if (crore) parts.push(`${chunkToWords(crore)} Crore`);
  if (lakh) parts.push(`${chunkToWords(lakh)} Lakh`);
  if (thousand) parts.push(`${chunkToWords(thousand)} Thousand`);
  if (rest) parts.push(chunkToWords(rest));
  return `${parts.join(" ")} Only.`;
}

export function todayInvoiceDate() {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}-${mm}-${d.getFullYear()}`;
}

export function nextInvoiceNo() {
  const n = String(Math.floor(100 + Math.random() * 900));
  return `SAFFO${n}`;
}

export function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0.00";
  return n.toFixed(2);
}

export function emptyParty() {
  return {
    name: "",
    address: "",
    contactPerson: "",
    mobile: "",
  };
}

export function linesFromAssets(selectedAssets) {
  return selectedAssets.map((asset) => {
    const qty = asset._bulk
      ? Math.max(1, Math.min(Number(asset.exportQty) || 1, Number(asset.availableQty) || 1))
      : 1;
    const description = [asset.assetName, asset.brand, asset.make]
      .map((v) => String(v || "").trim())
      .filter(Boolean)
      .filter((v, i, arr) => arr.indexOf(v) === i)
      .join(" · ") || "Asset";
    return {
      id: asset.id,
      description,
      serialNo: asset._bulk ? "" : (asset.serialNo === "—" ? "" : (asset.serialNo || "")),
      weight: "",
      qty: String(qty),
      rate: "",
    };
  });
}

export function lineAmount(line) {
  return (Number(line.qty) || 0) * (Number(line.rate) || 0);
}

export function invoiceTotals(lines) {
  const qty = lines.reduce((sum, line) => sum + (Number(line.qty) || 0), 0);
  const amount = lines.reduce((sum, line) => sum + lineAmount(line), 0);
  const weight = lines.reduce((sum, line) => {
    const n = parseFloat(String(line.weight || "").replace(/[^\d.]/g, ""));
    return sum + (Number.isFinite(n) ? n : 0);
  }, 0);
  return { qty, amount, weight };
}
