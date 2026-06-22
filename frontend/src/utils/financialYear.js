/** Indian financial year (April–March). */

export const FINANCIAL_YEAR_LOOKBACK = 10;

export function getFinancialYearStartYear(date = new Date()) {
    const y = date.getFullYear();
    const m = date.getMonth() + 1;
    return m >= 4 ? y : y - 1;
}

export function formatFinancialYearInput(value) {
    const digits = String(value ?? "").replace(/\D/g, "").slice(0, 8);
    if (digits.length <= 4) return digits;
    return `${digits.slice(0, 4)}-${digits.slice(4)}`;
}

export function financialYearFromStartYear(startYear) {
    const start = Number(startYear);
    if (!Number.isFinite(start)) return "";
    return formatFinancialYearInput(`${start}${start + 1}`);
}

export function defaultFinancialYear(date = new Date()) {
    return financialYearFromStartYear(getFinancialYearStartYear(date));
}

/**
 * Build a descending list of FY strings (YYYY-YYYY).
 * Includes current FY, prior years, optional future years, and any extras (e.g. from DB).
 */
export function financialYearOptions({
    yearsBack = FINANCIAL_YEAR_LOOKBACK,
    yearsForward = 0,
    date = new Date(),
    extraYears = [],
} = {}) {
    const start = getFinancialYearStartYear(date);
    const years = new Set(
        (extraYears || []).filter((fy) => isValidFinancialYear(fy))
    );

    for (let offset = -yearsForward; offset <= yearsBack; offset += 1) {
        years.add(financialYearFromStartYear(start - offset));
    }

    return Array.from(years).sort((a, b) => {
        const aStart = parseInt(String(a).split("-")[0], 10);
        const bStart = parseInt(String(b).split("-")[0], 10);
        return bStart - aStart;
    });
}

export function isValidFinancialYear(value) {
    return /^\d{4}-\d{4}$/.test(String(value ?? "").trim());
}

export function mergeFinancialYears(primary = [], extra = []) {
    return financialYearOptions({ yearsBack: 0, yearsForward: 0, extraYears: [...primary, ...extra] });
}
