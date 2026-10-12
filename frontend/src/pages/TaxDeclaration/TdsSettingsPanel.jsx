import { useCallback, useEffect, useState } from "react";
import { authHeaders, parseApiResponse } from "./taxDeclarationReviewUtils";
import { notifyError, notifySuccess } from "../../utils/notify";

const MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
];

const TEXT_FIELDS = [
    { key: "employer_name", label: "Employer name (letters, Form 16)", placeholder: "Acme Corp Pvt Ltd" },
    { key: "employer_tan", label: "Employer TAN", placeholder: "ABCD12345E" },
    { key: "employer_pan", label: "Employer PAN", placeholder: "ABCDE1234F" },
];

const NUMBER_FIELDS = [
    { key: "form16_variance_tolerance_inr", label: "Form 16 variance tolerance (₹)", min: 0, step: "1" },
    { key: "max_declaration_amendments_per_fy", label: "Max declaration amendments per FY", min: 0, step: "1" },
];

const CHECK_FIELDS = [
    { key: "payroll_tds_approved_only", label: "Payroll TDS uses approved declarations only" },
    { key: "block_employee_regime_change_after_submit", label: "Block employee regime change after submit" },
    { key: "regime_override_hr_only", label: "Only HR / Accounts can override the tax regime" },
    { key: "form16_variance_alert_enabled", label: "Alert when Form 16 TDS differs from payroll" },
];

const EDITABLE_KEYS = [
    ...TEXT_FIELDS.map((f) => f.key),
    ...NUMBER_FIELDS.map((f) => f.key),
    ...CHECK_FIELDS.map((f) => f.key),
    "declaration_deadline_default_day",
    "declaration_deadline_default_month",
];

function pickEditable(settings) {
    return Object.fromEntries(EDITABLE_KEYS.map((key) => [key, settings?.[key]]));
}

export function TdsSettingsPanel({ apiBase = "/api/accounts", onSaved }) {
    const [draft, setDraft] = useState(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch(`${apiBase}/tds-settings`, { headers: authHeaders() });
            const { ok, data } = await parseApiResponse(res);
            if (!ok || !data.success) throw new Error(data.message || "Failed to load TDS settings");
            setDraft(pickEditable(data.settings));
        } catch (err) {
            notifyError(err.message || "Unable to load TDS settings");
            setDraft(null);
        } finally {
            setLoading(false);
        }
    }, [apiBase]);

    useEffect(() => {
        load();
    }, [load]);

    const set = (key, value) => setDraft((d) => ({ ...d, [key]: value }));

    const save = async () => {
        if (!draft) return;
        setSaving(true);
        try {
            const res = await fetch(`${apiBase}/tds-settings`, {
                method: "PUT",
                headers: { "Content-Type": "application/json", ...authHeaders() },
                body: JSON.stringify(draft),
            });
            const { ok, data } = await parseApiResponse(res);
            if (!ok || !data.success) throw new Error(data.message || "Failed to save TDS settings");
            setDraft(pickEditable(data.settings));
            notifySuccess("Company TDS settings saved.");
            if (onSaved) onSaved(data.settings);
        } catch (err) {
            notifyError(err.message || "Unable to save TDS settings");
        } finally {
            setSaving(false);
        }
    };

    return (
        <section className="tax-decl-review-deadline tax-decl-tds-settings">
            <h3>Company TDS &amp; employer settings</h3>
            <p>
                Used on this company&apos;s offer, confirmation and relieving letters, F&amp;F and Form 16,
                and for declaration rules. Other companies keep their own values.
            </p>
            {loading && <p className="tax-decl-muted">Loading settings…</p>}
            {!loading && draft && (
                <>
                    <div className="tax-decl-tds-settings-grid">
                        {TEXT_FIELDS.map((f) => (
                            <label key={f.key} className="tax-decl-field">
                                <span className="tax-decl-label">{f.label}</span>
                                <input
                                    className="tax-decl-control"
                                    value={draft[f.key] || ""}
                                    placeholder={f.placeholder}
                                    onChange={(e) => set(f.key, e.target.value)}
                                    disabled={saving}
                                />
                            </label>
                        ))}
                        {NUMBER_FIELDS.map((f) => (
                            <label key={f.key} className="tax-decl-field">
                                <span className="tax-decl-label">{f.label}</span>
                                <input
                                    type="number"
                                    className="tax-decl-control"
                                    min={f.min}
                                    step={f.step}
                                    value={draft[f.key] ?? ""}
                                    onChange={(e) => set(f.key, e.target.value)}
                                    disabled={saving}
                                />
                            </label>
                        ))}
                        <label className="tax-decl-field">
                            <span className="tax-decl-label">Default declaration deadline (FY end year)</span>
                            <div className="tax-decl-tds-settings-date">
                                <input
                                    type="number"
                                    className="tax-decl-control"
                                    min={1}
                                    max={31}
                                    aria-label="Deadline day"
                                    value={draft.declaration_deadline_default_day ?? ""}
                                    onChange={(e) => set("declaration_deadline_default_day", e.target.value)}
                                    disabled={saving}
                                />
                                <select
                                    className="tax-decl-control"
                                    aria-label="Deadline month"
                                    value={draft.declaration_deadline_default_month ?? 2}
                                    onChange={(e) => set("declaration_deadline_default_month", Number(e.target.value))}
                                    disabled={saving}
                                >
                                    {MONTHS.map((name, idx) => (
                                        <option key={name} value={idx + 1}>{name}</option>
                                    ))}
                                </select>
                            </div>
                        </label>
                    </div>
                    <div className="tax-decl-tds-settings-checks">
                        {CHECK_FIELDS.map((f) => (
                            <label key={f.key} className="tax-decl-field tax-decl-field--inline-check">
                                <input
                                    type="checkbox"
                                    className="tax-decl-checkbox"
                                    checked={!!draft[f.key]}
                                    onChange={(e) => set(f.key, e.target.checked)}
                                    disabled={saving}
                                />
                                <span>{f.label}</span>
                            </label>
                        ))}
                    </div>
                    <div className="tax-decl-review-deadline-actions">
                        <button
                            type="button"
                            className="tax-decl-btn tax-decl-btn--primary"
                            onClick={save}
                            disabled={saving}
                        >
                            {saving ? "Saving…" : "Save TDS settings"}
                        </button>
                    </div>
                </>
            )}
        </section>
    );
}

export default TdsSettingsPanel;
