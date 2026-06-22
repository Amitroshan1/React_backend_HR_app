import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, ChevronDown, ChevronUp, FileText, Upload } from "lucide-react";
import { useUser } from "../../components/layout/UserContext";
import { useRefreshOnNavigate } from "../../hooks/useRefreshOnNavigate";
import { TaxDeclarationActions } from "./TaxDeclarationActions";
import {
    clampAmountInput,
    docsForItem,
    formatCapINR,
    formatSectionCapSummary,
    generalDocuments,
    getCapLabel,
    itemEffectiveCap,
    itemKey,
} from "./taxDeclarationCaps";
import {
    defaultFinancialYear,
    financialYearOptions,
    mergeFinancialYears,
} from "../../utils/financialYear";
import "./TaxDeclaration.css";

const AUTH_API = "/api/auth";

const normalizeRegime = (v) => ((v || "").toLowerCase().includes("old") ? "old" : "new");

async function parseApiResponse(res) {
    const text = await res.text();
    if (!text) return { ok: res.ok, data: {} };
    try {
        return { ok: res.ok, data: JSON.parse(text) };
    } catch {
        throw new Error(
            res.status === 404
                ? "Tax declaration API not found. Restart the backend server."
                : "Server returned an invalid response."
        );
    }
}

function itemsFromDeclaration(declItems = []) {
    const map = {};
    declItems.forEach((it) => {
        const k = itemKey(it.section_code, it.item_code);
        if (it.item_code === "IS_METRO") {
            map[k] = {
                section_code: it.section_code,
                item_code: it.item_code,
                type: "boolean",
                value: (it.text_value || "").toLowerCase() === "true",
            };
        } else if (it.amount != null && it.amount !== "") {
            map[k] = {
                section_code: it.section_code,
                item_code: it.item_code,
                type: "amount",
                amount: it.amount,
            };
        } else {
            map[k] = {
                section_code: it.section_code,
                item_code: it.item_code,
                type: "text",
                text_value: it.text_value || "",
            };
        }
    });
    return map;
}

function buildItemsArray(itemsMap, schema) {
    const out = [];
    (schema?.sections || []).forEach((sec) => {
        (sec.items || []).forEach((def) => {
            const k = itemKey(sec.id, def.code);
            const row = itemsMap[k];
            if (!row) return;
            if (def.type === "boolean") {
                out.push({
                    section_code: sec.id,
                    item_code: def.code,
                    type: "boolean",
                    value: Boolean(row.value),
                    text_value: row.value ? "true" : "false",
                });
            } else if (def.type === "text") {
                out.push({
                    section_code: sec.id,
                    item_code: def.code,
                    text_value: row.text_value || "",
                });
            } else {
                out.push({
                    section_code: sec.id,
                    item_code: def.code,
                    amount: row.amount === "" || row.amount == null ? 0 : Number(row.amount),
                });
            }
        });
    });
    return out;
}

function sectionVisible(sec, regime) {
    const when = sec.visible_when?.regime;
    if (!when) return true;
    return when === regime;
}

export const TaxDeclaration = () => {
    const navigate = useNavigate();
    const { userData } = useUser();
    const userId = userData?.user?.id;

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [schema, setSchema] = useState(null);
    const [, setRules] = useState({ old: {}, new: {} });
    const [employee, setEmployee] = useState(null);
    const [ctc, setCtc] = useState({});
    const [documents, setDocuments] = useState([]);
    const [status, setStatus] = useState("draft");
    const [rejectionReason, setRejectionReason] = useState("");
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");
    const [openSections, setOpenSections] = useState({});

    const [financialYear, setFinancialYear] = useState(defaultFinancialYear);
    const [fyOptions, setFyOptions] = useState(() => financialYearOptions());
    const [taxRegime, setTaxRegime] = useState("new");
    const [itemsMap, setItemsMap] = useState({});
    const [regimeAccepted, setRegimeAccepted] = useState(false);
    const [newRegimeAck, setNewRegimeAck] = useState(false);
    const [finalAccepted, setFinalAccepted] = useState(false);
    const [declarationPlace, setDeclarationPlace] = useState("");
    const [uploadDocType, setUploadDocType] = useState("pan_card");
    const [uploadingKey, setUploadingKey] = useState(null);

    const authHeaders = () => {
        const token = localStorage.getItem("token");
        return token ? { Authorization: `Bearer ${token}` } : {};
    };

    const regime = normalizeRegime(taxRegime);
    const isLocked = status === "submitted" || status === "approved";

    const loadFinancialYears = useCallback(async () => {
        try {
            const res = await fetch(`${AUTH_API}/tax-declaration/financial-years`, {
                headers: authHeaders(),
            });
            const { ok, data } = await parseApiResponse(res);
            if (ok && data.success && Array.isArray(data.financial_years) && data.financial_years.length) {
                setFyOptions(data.financial_years);
            } else {
                setFyOptions(financialYearOptions());
            }
        } catch {
            setFyOptions(financialYearOptions());
        }
    }, []);

    useEffect(() => {
        loadFinancialYears();
    }, [loadFinancialYears]);

    const sectionCapSummaries = useMemo(() => {
        const out = {};
        (schema?.sections || []).forEach((sec) => {
            const summary = formatSectionCapSummary(sec, itemsMap, ctc);
            if (summary) out[sec.id] = summary;
        });
        return out;
    }, [schema, itemsMap, ctc]);

    const generalDocs = useMemo(() => generalDocuments(documents), [documents]);

    const loadData = useCallback(async (fy) => {
        if (!userId) return;
        setLoading(true);
        setError("");
        try {
            const res = await fetch(
                `${AUTH_API}/tax-declaration/self?financial_year=${encodeURIComponent(fy)}`,
                { headers: authHeaders() }
            );
            const { ok, data } = await parseApiResponse(res);
            if (!ok || !data.success) throw new Error(data.message || "Failed to load");

            if (data.financial_year) {
                setFyOptions((prev) => mergeFinancialYears(prev, [data.financial_year]));
            }

            setSchema(data.schema || {});
            setRules(data.rules || { old: {}, new: {} });
            setEmployee(data.employee || {});
            setCtc(data.ctc || {});
            const decl = data.declaration;
            const map = decl ? itemsFromDeclaration(decl.items || []) : {};
            if (data.ctc?.epf_annual != null) {
                map[itemKey("80C", "EPF")] = {
                    section_code: "80C",
                    item_code: "EPF",
                    type: "amount",
                    amount: data.ctc.epf_annual,
                    readonly: true,
                };
            }
            setItemsMap(map);

            if (decl) {
                setStatus(decl.status || "draft");
                setRejectionReason(decl.rejection_reason || "");
                setTaxRegime(normalizeRegime(decl.tax_regime) === "old" ? "old" : "new");
                setDocuments(decl.documents || []);
                setRegimeAccepted(Boolean(decl.regime_declaration_accepted));
                setNewRegimeAck(Boolean(decl.new_regime_acknowledged));
                setFinalAccepted(Boolean(decl.final_declaration_accepted));
                setDeclarationPlace(decl.declaration_place || "");
            } else {
                setStatus("draft");
                setRejectionReason("");
                const profRegime = data.profile?.tax_regime || data.employee?.tax_regime;
                setTaxRegime(normalizeRegime(profRegime) === "old" ? "old" : "new");
                setDocuments([]);
                setRegimeAccepted(false);
                setNewRegimeAck(false);
                setFinalAccepted(false);
                setDeclarationPlace("");
            }
        } catch (err) {
            setError(err.message || "Unable to load tax declaration");
        } finally {
            setLoading(false);
        }
    }, [userId]);

    useRefreshOnNavigate(() => {
        if (userId) loadData(financialYear);
        else setLoading(false);
    }, [userId, financialYear, loadData]);

    const setItem = (section, code, type, value) => {
        const k = itemKey(section, code);
        setItemsMap((prev) => ({
            ...prev,
            [k]: { section_code: section, item_code: code, type, ...value },
        }));
    };

    const toggleSection = (id) => {
        setOpenSections((prev) => ({ ...prev, [id]: !prev[id] }));
    };

    const save = async (submit) => {
        setSaving(true);
        setError("");
        setSuccess("");
        try {
            const body = {
                financial_year: financialYear,
                tax_regime: taxRegime === "old" ? "Old Tax Regime" : "New Tax Regime",
                items: buildItemsArray(itemsMap, schema),
                regime_declaration_accepted: regimeAccepted,
                new_regime_acknowledged: newRegimeAck,
                final_declaration_accepted: finalAccepted,
                declaration_place: declarationPlace,
                declaration_signed_at: new Date().toISOString().slice(0, 10),
                submit,
            };
            const res = await fetch(`${AUTH_API}/tax-declaration/self`, {
                method: "POST",
                headers: { "Content-Type": "application/json", ...authHeaders() },
                body: JSON.stringify(body),
            });
            const { ok, data } = await parseApiResponse(res);
            if (!ok || !data.success) {
                const msg = data.errors?.length
                    ? data.errors.join(" ")
                    : (data.message || "Save failed");
                throw new Error(msg);
            }
            setStatus(data.declaration?.status || (submit ? "submitted" : "draft"));
            setDocuments(data.declaration?.documents || documents);
            setSuccess(data.message);
            if (submit) setRejectionReason("");
        } catch (err) {
            setError(err.message || "Unable to save");
        } finally {
            setSaving(false);
        }
    };

    const handleItemUpload = async (e, sec, def) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const key = itemKey(sec.id, def.code);
        setUploadingKey(key);
        setError("");
        try {
            const fd = new FormData();
            fd.append("financial_year", financialYear);
            fd.append("doc_type", def.document_type || "other");
            fd.append("section_code", sec.id);
            fd.append("item_code", def.code);
            fd.append("file", file);
            const res = await fetch(`${AUTH_API}/tax-declaration/self/documents`, {
                method: "POST",
                headers: authHeaders(),
                body: fd,
            });
            const { ok, data } = await parseApiResponse(res);
            if (!ok || !data.success) throw new Error(data.message || "Upload failed");
            setDocuments((prev) => {
                const filtered = prev.filter(
                    (d) =>
                        String(d.section_code || "").toUpperCase() !== String(sec.id).toUpperCase()
                        || String(d.item_code || "").toUpperCase() !== String(def.code).toUpperCase()
                );
                return [...filtered, data.document];
            });
            setSuccess("Document uploaded.");
        } catch (err) {
            setError(err.message || "Upload failed");
        } finally {
            setUploadingKey(null);
            e.target.value = "";
        }
    };

    const handleUpload = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setError("");
        try {
            const fd = new FormData();
            fd.append("financial_year", financialYear);
            fd.append("doc_type", uploadDocType);
            fd.append("file", file);
            const res = await fetch(`${AUTH_API}/tax-declaration/self/documents`, {
                method: "POST",
                headers: authHeaders(),
                body: fd,
            });
            const { ok, data } = await parseApiResponse(res);
            if (!ok || !data.success) throw new Error(data.message || "Upload failed");
            setDocuments((prev) => [...prev, data.document]);
            setSuccess("Document uploaded.");
        } catch (err) {
            setError(err.message || "Upload failed");
        } finally {
            e.target.value = "";
        }
    };

    const removeDoc = async (docId) => {
        try {
            const res = await fetch(`${AUTH_API}/tax-declaration/self/documents/${docId}`, {
                method: "DELETE",
                headers: authHeaders(),
            });
            const { ok, data } = await parseApiResponse(res);
            if (!ok || !data.success) throw new Error(data.message || "Delete failed");
            setDocuments((prev) => prev.filter((d) => d.id !== docId));
        } catch (err) {
            setError(err.message || "Delete failed");
        }
    };

    const renderAmountItemRow = (sec, def) => {
        const k = itemKey(sec.id, def.code);
        const row = itemsMap[k] || {};
        const readonly = isLocked || def.readonly || def.code === "EPF";
        const capLabel = getCapLabel(def, sec, itemsMap, ctc);
        const itemCap = itemEffectiveCap(def, sec, itemsMap, ctc);
        const itemDocs = docsForItem(documents, sec.id, def.code);
        const isUploading = uploadingKey === k;
        const overCap = itemCap != null && Number(row.amount || 0) > itemCap;

        return (
            <div key={k} className={`tax-decl-item-row${overCap ? " tax-decl-item-row--over" : ""}`}>
                <div className="tax-decl-item-row__label">
                    <strong>{def.label}</strong>
                    {capLabel && <span className="tax-decl-item-row__cap">{capLabel}</span>}
                </div>
                <div className="tax-decl-item-row__amount">
                    <input
                        type="number"
                        min="0"
                        max={itemCap != null ? itemCap : undefined}
                        step="1"
                        className="tax-decl-control"
                        disabled={readonly}
                        value={row.amount ?? ""}
                        onChange={(e) => {
                            const val = clampAmountInput(e.target.value, itemCap);
                            setItem(sec.id, def.code, "amount", { amount: val });
                        }}
                        placeholder="0"
                        title={
                            itemCap != null
                                ? `Maximum for this line: ${formatCapINR(itemCap)}`
                                : undefined
                        }
                    />
                </div>
                <div className="tax-decl-item-row__proof">
                    {def.proof_required && !readonly ? (
                        <>
                            <label className="tax-decl-item-upload">
                                <Upload size={14} aria-hidden />
                                {isUploading ? "Uploading…" : itemDocs.length ? "Replace" : "Upload proof"}
                                <input
                                    type="file"
                                    accept=".pdf,.jpg,.jpeg,.png"
                                    hidden
                                    disabled={isUploading}
                                    onChange={(ev) => handleItemUpload(ev, sec, def)}
                                />
                            </label>
                            {itemDocs.map((doc) => (
                                <div key={doc.id} className="tax-decl-item-doc">
                                    <a href={doc.url} target="_blank" rel="noopener noreferrer">
                                        {doc.original_name || "View"}
                                    </a>
                                    {!isLocked && (
                                        <button type="button" onClick={() => removeDoc(doc.id)}>×</button>
                                    )}
                                </div>
                            ))}
                        </>
                    ) : (
                        <span className="tax-decl-muted">—</span>
                    )}
                </div>
            </div>
        );
    };

    const renderSectionFields = (sec) => {
        const amountItems = (sec.items || []).filter((d) => d.type === "amount");
        const otherItems = (sec.items || []).filter((d) => d.type !== "amount");
        const useItemTable = regime === "old" && sec.visible_when?.regime === "old" && amountItems.length > 0;
        const capSummary = sectionCapSummaries[sec.id];

        return (
            <>
                {useItemTable && (
                    <div className="tax-decl-item-table">
                        {capSummary && (
                            <div
                                className={`tax-decl-section-remaining${capSummary.remaining === 0 ? " tax-decl-section-remaining--full" : ""}`}
                                role="status"
                            >
                                {capSummary.label}
                            </div>
                        )}
                        <div className="tax-decl-item-table-head">
                            <span>Investment / deduction</span>
                            <span>Amount (₹)</span>
                            <span>Supporting proof</span>
                        </div>
                        {amountItems.map((def) => renderAmountItemRow(sec, def))}
                    </div>
                )}
                <div className={useItemTable ? "tax-decl-form tax-decl-form--after-table" : "tax-decl-form"}>
                    {(useItemTable ? otherItems : sec.items || []).map((def) => renderField(sec, def))}
                </div>
            </>
        );
    };

    const renderField = (sec, def) => {
        const k = itemKey(sec.id, def.code);
        const row = itemsMap[k] || {};
        const readonly = isLocked || def.readonly || def.code === "EPF";

        if (def.type === "boolean") {
            return (
                <label key={k} className="tax-decl-field tax-decl-field--check">
                    <input
                        type="checkbox"
                        className="tax-decl-checkbox"
                        disabled={readonly}
                        checked={Boolean(row.value)}
                        onChange={(e) => setItem(sec.id, def.code, "boolean", { value: e.target.checked })}
                    />
                    <span className="tax-decl-label">{def.label}</span>
                </label>
            );
        }
        if (def.type === "text") {
            return (
                <label key={k} className="tax-decl-field">
                    <span className="tax-decl-label">{def.label}</span>
                    <input
                        type="text"
                        className="tax-decl-control"
                        disabled={readonly}
                        value={row.text_value || ""}
                        onChange={(e) => setItem(sec.id, def.code, "text", { text_value: e.target.value })}
                    />
                </label>
            );
        }
        return (
            <label key={k} className="tax-decl-field">
                <span className="tax-decl-label">{def.label}</span>
                <input
                    type="number"
                    min="0"
                    className="tax-decl-control"
                    disabled={readonly}
                    value={row.amount ?? ""}
                    onChange={(e) => setItem(sec.id, def.code, "amount", { amount: e.target.value })}
                />
            </label>
        );
    };

    return (
        <div className="tax-decl-page">
            <button type="button" className="tax-decl-back" onClick={() => navigate("/dashboard")}>
                <ArrowLeft size={18} aria-hidden />
                Back to Dashboard
            </button>

            <div className="tax-decl-card">
                <div className="tax-decl-header">
                    <div className="tax-decl-header-main">
                        <div className="tax-decl-header-icon">
                            <FileText size={22} aria-hidden />
                        </div>
                        <div>
                            <h1>Tax Saving Declaration</h1>
                            <p>
                                FY {financialYear}
                                {status ? ` · ${status.replace(/_/g, " ")}` : ""}
                            </p>
                        </div>
                    </div>
                    <TaxDeclarationActions hasCtcData={Boolean(ctc?.has_ctc)} />
                </div>

                {loading && <p className="tax-decl-muted">Loading…</p>}
                {error && <div className="tax-decl-alert tax-decl-alert--error" role="alert">{error}</div>}
                {success && <div className="tax-decl-alert tax-decl-alert--success" role="status">{success}</div>}

                {!loading && (
                    <>
                        {status === "rejected" && rejectionReason && (
                            <div className="tax-decl-banner tax-decl-banner--warn">
                                Rejected: {rejectionReason}. Please update and resubmit.
                            </div>
                        )}
                        {isLocked && (
                            <div className="tax-decl-banner tax-decl-banner--submitted">
                                This declaration is locked while under review or approved.
                            </div>
                        )}

                        <section className="tax-decl-section">
                            <h2 className="tax-decl-section-title">Employee Information</h2>
                            <div className="tax-decl-info-grid">
                                <div><span>Employee ID</span><strong>{employee?.employee_id || "—"}</strong></div>
                                <div><span>Employee Name</span><strong>{employee?.employee_name || "—"}</strong></div>
                                <div><span>Department</span><strong>{employee?.department || "—"}</strong></div>
                                <div><span>Designation</span><strong>{employee?.designation || "—"}</strong></div>
                                <div><span>PAN</span><strong>{employee?.pan || "—"}</strong></div>
                                <label className="tax-decl-field">
                                    <span className="tax-decl-label">Financial Year</span>
                                    <select
                                        className="tax-decl-control"
                                        disabled={isLocked}
                                        value={financialYear}
                                        onChange={(e) => {
                                            setFinancialYear(e.target.value);
                                            loadData(e.target.value);
                                        }}
                                    >
                                        {fyOptions.map((fy) => (
                                            <option key={fy} value={fy}>{fy}</option>
                                        ))}
                                    </select>
                                </label>
                            </div>
                        </section>

                        <section className="tax-decl-section">
                            <h2 className="tax-decl-section-title">
                                {schema?.regime_section?.title || "Section A: Tax Regime Selection"}
                            </h2>
                            <div className="tax-decl-regime-radios">
                                <label className="tax-decl-radio">
                                    <input
                                        type="radio"
                                        name="tax_regime"
                                        disabled={isLocked}
                                        checked={taxRegime === "old"}
                                        onChange={() => setTaxRegime("old")}
                                    />
                                    Old Tax Regime
                                </label>
                                <label className="tax-decl-radio">
                                    <input
                                        type="radio"
                                        name="tax_regime"
                                        disabled={isLocked}
                                        checked={taxRegime === "new"}
                                        onChange={() => setTaxRegime("new")}
                                    />
                                    New Tax Regime
                                </label>
                            </div>
                            <p className="tax-decl-decl-text">
                                {schema?.regime_section?.declaration_text}
                            </p>
                            <label className="tax-decl-field tax-decl-field--check">
                                <input
                                    type="checkbox"
                                    className="tax-decl-checkbox"
                                    disabled={isLocked}
                                    checked={regimeAccepted}
                                    onChange={(e) => setRegimeAccepted(e.target.checked)}
                                />
                                <span className="tax-decl-label">I accept the tax regime declaration above</span>
                            </label>
                        </section>

                        {regime === "new" && (
                            <section className="tax-decl-section">
                                <h2 className="tax-decl-section-title">
                                    {schema?.new_regime_section?.title || "Section C: New Tax Regime"}
                                </h2>
                                <p className="tax-decl-decl-text">
                                    {schema?.new_regime_section?.acknowledgment_text}
                                </p>
                                <label className="tax-decl-field tax-decl-field--check">
                                    <input
                                        type="checkbox"
                                        className="tax-decl-checkbox"
                                        disabled={isLocked}
                                        checked={newRegimeAck}
                                        onChange={(e) => setNewRegimeAck(e.target.checked)}
                                    />
                                    <span className="tax-decl-label">I confirm New Tax Regime selection</span>
                                </label>
                            </section>
                        )}

                        {(schema?.sections || [])
                            .filter((sec) => sectionVisible(sec, regime))
                            .map((sec) => (
                                <section key={sec.id} className="tax-decl-section tax-decl-section--collapsible">
                                    <button
                                        type="button"
                                        className="tax-decl-section-toggle"
                                        onClick={() => toggleSection(sec.id)}
                                    >
                                        <span>
                                            {sec.title}
                                            {sectionCapSummaries[sec.id] && (
                                                <small className="tax-decl-cap">
                                                    Remaining {formatCapINR(sectionCapSummaries[sec.id].remaining)}
                                                    {" / "}
                                                    {formatCapINR(sectionCapSummaries[sec.id].cap)}
                                                </small>
                                            )}
                                        </span>
                                        {openSections[sec.id] ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                                    </button>
                                    {openSections[sec.id] !== false && renderSectionFields(sec)}
                                </section>
                            ))}

                        <section className="tax-decl-section">
                            <h2 className="tax-decl-section-title">Section F: General Documents</h2>
                            <p className="tax-decl-muted">Upload PAN and any other general supporting documents (PDF, JPG, PNG — max 5 MB)</p>
                            {!isLocked && (
                                <div className="tax-decl-upload-row">
                                    <select
                                        className="tax-decl-control tax-decl-control--compact"
                                        value={uploadDocType}
                                        onChange={(e) => setUploadDocType(e.target.value)}
                                    >
                                        {(schema?.general_document_types || schema?.document_types || []).map((d) => (
                                            <option key={d.code} value={d.code}>{d.label}</option>
                                        ))}
                                    </select>
                                    <label className="tax-decl-upload-btn">
                                        <Upload size={16} />
                                        {uploadingKey === "general" ? "Uploading…" : "Choose file"}
                                        <input
                                            type="file"
                                            accept=".pdf,.jpg,.jpeg,.png"
                                            hidden
                                            onChange={async (e) => {
                                                setUploadingKey("general");
                                                await handleUpload(e);
                                                setUploadingKey(null);
                                            }}
                                        />
                                    </label>
                                </div>
                            )}
                            <ul className="tax-decl-doc-list">
                                {generalDocs.map((doc) => (
                                    <li key={doc.id}>
                                        <a href={doc.url} target="_blank" rel="noopener noreferrer">
                                            {doc.original_name || doc.doc_type}
                                        </a>
                                        {!isLocked && (
                                            <button type="button" onClick={() => removeDoc(doc.id)}>Remove</button>
                                        )}
                                    </li>
                                ))}
                                {generalDocs.length === 0 && <li className="tax-decl-muted">No general documents uploaded yet.</li>}
                            </ul>
                        </section>

                        <section className="tax-decl-section">
                            <h2 className="tax-decl-section-title">Employee Declaration</h2>
                            <p className="tax-decl-decl-text">{schema?.final_declaration?.text}</p>
                            <label className="tax-decl-field tax-decl-field--place">
                                <span className="tax-decl-label">Place</span>
                                <input
                                    type="text"
                                    className="tax-decl-control"
                                    disabled={isLocked}
                                    value={declarationPlace}
                                    onChange={(e) => setDeclarationPlace(e.target.value)}
                                    placeholder="City / town"
                                />
                            </label>
                            <div className="tax-decl-sign-grid">
                                <div>
                                    <span className="tax-decl-sign-label">Name</span>
                                    <strong>{employee?.employee_name || "—"}</strong>
                                </div>
                                <div>
                                    <span className="tax-decl-sign-label">Employee ID</span>
                                    <strong>{employee?.employee_id || "—"}</strong>
                                </div>
                                <div>
                                    <span className="tax-decl-sign-label">Date</span>
                                    <strong>{new Date().toLocaleDateString("en-IN")}</strong>
                                </div>
                            </div>
                            <label className="tax-decl-field tax-decl-field--check">
                                <input
                                    type="checkbox"
                                    className="tax-decl-checkbox"
                                    disabled={isLocked}
                                    checked={finalAccepted}
                                    onChange={(e) => setFinalAccepted(e.target.checked)}
                                />
                                <span className="tax-decl-label">I accept the final declaration</span>
                            </label>
                        </section>

                        <div className="tax-decl-actions">
                            {!isLocked && (
                                <>
                                    <button
                                        type="button"
                                        className="tax-decl-btn tax-decl-btn--secondary"
                                        disabled={saving || !ctc.has_ctc}
                                        onClick={() => save(false)}
                                    >
                                        {saving ? "Saving…" : "Save draft"}
                                    </button>
                                    <button
                                        type="button"
                                        className="tax-decl-btn tax-decl-btn--primary"
                                        disabled={saving || !ctc.has_ctc}
                                        onClick={() => save(true)}
                                    >
                                        {saving ? "Submitting…" : "Submit declaration"}
                                    </button>
                                </>
                            )}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};
