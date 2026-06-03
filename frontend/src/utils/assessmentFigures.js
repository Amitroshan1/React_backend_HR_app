import q03 from "../assets/assessment-figures/q03.png";
import q04 from "../assets/assessment-figures/q04.png";
import q05 from "../assets/assessment-figures/q05.svg";
import q06 from "../assets/assessment-figures/q06.svg";
import q07 from "../assets/assessment-figures/q07.svg";
import q12 from "../assets/assessment-figures/q12.svg";
import q23 from "../assets/assessment-figures/q23.svg";

/** Bundled figure URLs — work in dev and production without relying on /api or /public paths. */
export const ASSESSMENT_FIGURE_SRC = {
  3: q03,
  4: q04,
  5: q05,
  6: q06,
  7: q07,
  12: q12,
  23: q23,
};

const API_FIGURE_BASE = "/api/HumanResource/assessment/public/figures";

/** Drop leading "9)", "Q9.", etc. when the UI already shows Q9. */
export function stripLeadingQuestionNumber(text, questionNumber) {
  if (!text) return "";
  let s = String(text).trim();
  const n = Number(questionNumber);
  if (!Number.isFinite(n) || n < 1) return s;
  const num = String(n);
  const patterns = [
    new RegExp(`^Q\\s*${num}\\s*[.)]?\\s*`, "i"),
    new RegExp(`^${num}\\s*\\)\\s*`),
    new RegExp(`^${num}\\s*\\.\\s*`),
    new RegExp(`^${num}\\s*:\\s*`),
  ];
  for (const re of patterns) {
    const next = s.replace(re, "").trim();
    if (next !== s) return next;
  }
  return s;
}

/** e.g. Q9 + "9) In a math..." → "Q9. In a math..." */
export function formatAssessmentQuestionHeading(questionNumber, questionText) {
  const n = Number(questionNumber);
  const body = stripLeadingQuestionNumber(questionText, n);
  if (!body) return `Q${n}`;
  return `Q${n}. ${body}`;
}

export function getAssessmentFigureSrc(questionNumber, imageUrl) {
  const n = Number(questionNumber);
  if (ASSESSMENT_FIGURE_SRC[n]) return ASSESSMENT_FIGURE_SRC[n];

  const url = String(imageUrl || "").trim();
  if (!url) return "";
  if (url.startsWith("/api/")) return url;
  const name = url.split("/").filter(Boolean).pop();
  if (name && /^q\d{2}\.(svg|png)$/i.test(name)) {
    return `${API_FIGURE_BASE}/${name}`;
  }
  if (url.startsWith("/assessment-figures/")) {
    return `${API_FIGURE_BASE}/${url.split("/").pop()}`;
  }
  return url;
}
