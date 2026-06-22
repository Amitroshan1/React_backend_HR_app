const itemKey = (section, code) => `${section}__${code}`;

export function formatCapINR(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return null;
    if (n === 0) return "₹0";
    return `₹${n.toLocaleString("en-IN")}`;
}

export function getItemAmount(itemsMap, sectionId, code, ctc = {}) {
    const k = itemKey(sectionId, code);
    if (code === "EPF") return Number(ctc.epf_annual || itemsMap[k]?.amount || 0);
    const v = Number(itemsMap[k]?.amount || 0);
    return Number.isFinite(v) ? v : 0;
}

export function getSectionCap(sec) {
    const cap = Number(sec?.cap_amount);
    return Number.isFinite(cap) && cap > 0 ? cap : 0;
}

export function hasSharedSectionCap(sec) {
    return getSectionCap(sec) > 0;
}

export function getSectionAmountTotal(sec, itemsMap, ctc = {}) {
    let sum = 0;
    (sec.items || []).forEach((def) => {
        if (def.type !== "amount") return;
        sum += getItemAmount(itemsMap, sec.id, def.code, ctc);
    });
    return sum;
}

/** Amount still available in a shared section cap (e.g. 80C). */
export function getSectionRemaining(sec, itemsMap, ctc = {}) {
    const cap = getSectionCap(sec);
    if (cap <= 0) return null;
    const used = getSectionAmountTotal(sec, itemsMap, ctc);
    return Math.max(0, cap - used);
}

/**
 * Max allowed in this field when the section shares one cap (80C).
 * = section cap minus all other lines (including EPF), not counting this field's current value.
 */
export function getSharedSectionItemMax(sec, def, itemsMap, ctc = {}) {
    if (def.cap_scope !== "section" || def.readonly) return null;
    const cap = getSectionCap(sec);
    if (cap <= 0) return null;

    let others = 0;
    (sec.items || []).forEach((item) => {
        if (item.type !== "amount") return;
        if (item.code === def.code) return;
        others += getItemAmount(itemsMap, sec.id, item.code, ctc);
    });
    return Math.max(0, cap - others);
}

export function getCapLabel(def, sec, itemsMap, ctc) {
    if (def.cap_scope === "item" && def.cap_amount > 0) {
        return `Max ${formatCapINR(def.cap_amount)}`;
    }
    if (def.cap_scope === "section" && hasSharedSectionCap(sec)) {
        if (def.readonly) {
            const amt = getItemAmount(itemsMap, sec.id, def.code, ctc);
            if (amt > 0) {
                return `Uses ${formatCapINR(amt)} from section limit`;
            }
            return `Part of section limit ${formatCapINR(sec.cap_amount)}`;
        }
        const maxForLine = getSharedSectionItemMax(sec, def, itemsMap, ctc);
        if (maxForLine != null) {
            return `You can enter up to ${formatCapINR(maxForLine)}`;
        }
    }
    if (def.proof_required) return "Proof required if amount entered";
    return null;
}

export function docsForItem(documents, sectionCode, itemCode) {
    const s = String(sectionCode || "").toUpperCase();
    const c = String(itemCode || "").toUpperCase();
    return (documents || []).filter(
        (d) =>
            String(d.section_code || "").toUpperCase() === s
            && String(d.item_code || "").toUpperCase() === c
    );
}

export function generalDocuments(documents) {
    return (documents || []).filter((d) => !d.section_code || !d.item_code);
}

export function clampAmountInput(value, maxCap) {
    if (maxCap == null || maxCap < 0) return value;
    const n = Number(value);
    if (value === "" || value == null || Number.isNaN(n)) return value;
    if (n > maxCap) return String(maxCap);
    if (n < 0) return "0";
    return value;
}

export function itemEffectiveCap(def, sec, itemsMap, ctc) {
    if (def.cap_scope === "item" && def.cap_amount > 0) return def.cap_amount;
    if (def.cap_scope === "section" && hasSharedSectionCap(sec) && !def.readonly) {
        return getSharedSectionItemMax(sec, def, itemsMap, ctc);
    }
    return null;
}

export function formatSectionCapSummary(sec, itemsMap, ctc) {
    const cap = getSectionCap(sec);
    if (cap <= 0) return null;
    const used = getSectionAmountTotal(sec, itemsMap, ctc);
    const remaining = Math.max(0, cap - used);
    return {
        cap,
        used,
        remaining,
        label: `Used ${formatCapINR(used)} / ${formatCapINR(cap)} · Remaining ${formatCapINR(remaining)}`,
    };
}

export { itemKey };
