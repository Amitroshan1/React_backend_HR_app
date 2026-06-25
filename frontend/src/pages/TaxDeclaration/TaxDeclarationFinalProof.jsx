import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, CheckCircle2, FileCheck, Upload } from "lucide-react";
import { useUser } from "../../components/layout/UserContext";
import { useRefreshOnNavigate } from "../../hooks/useRefreshOnNavigate";
import {
    defaultFinancialYear,
    financialYearOptions,
    mergeFinancialYears,
} from "../../utils/financialYear";
import { notifyError, notifySuccess } from "../../utils/notify";
import { docsForItem, FINAL_PROOF_DOC_TYPE, itemKey } from "./taxDeclarationCaps";
import "./TaxDeclaration.css";

const AUTH_API = "/api/auth";

const normalizeRegime = (v) => ((v || "").toLowerCase().includes("old") ? "old" : "new");

async function parseApiResponse(res) {
    const text = await res.text();
    if (!text) return { ok: res.ok, data: {} };
    try {
        return { ok: res.ok, data: JSON.parse(text) };
    } catch {
        throw new Error("Server returned an invalid response.");
    }
}

function sectionVisible(sec, regime) {
    const when = sec?.visible_when?.regime;
    if (!when) return true;
    return when === regime;
}

function formatAmount(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "—";
    return `₹${n.toLocaleString("en-IN")}`;
}

function statusLabel(status) {
    if (!status) return "Not started";
    return String(status).replace(/_/g, " ");
}

export function TaxDeclarationFinalProof() {
    const navigate = useNavigate();
    const { userData } = useUser();
    const userId = userData?.user?.id;

    const [financialYear, setFinancialYear] = useState(defaultFinancialYear);
    const [fyOptions, setFyOptions] = useState(() => financialYearOptions());
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const [schema, setSchema] = useState(null);
    const [declaration, setDeclaration] = useState(null);
    const [documents, setDocuments] = useState([]);
    const [editable, setEditable] = useState(false);
    const [regime, setRegime] = useState("new");
    const [finalAmounts, setFinalAmounts] = useState({});
    const [uploadingKey, setUploadingKey] = useState(null);

    const authHeaders = () => {
        const token = localStorage.getItem("token");
        return token ? { Authorization: `Bearer ${token}` } : {};
    };

    const hydrateFinalAmounts = useCallback((decl, sch, reg) => {
        const map = {};
        const items = decl?.items || [];
        (sch?.sections || []).forEach((sec) => {
            if (!sectionVisible(sec, reg)) return;
            (sec.items || []).forEach((def) => {
                if (def.type !== "amount" || def.readonly || def.code === "EPF") return;
                const k = itemKey(sec.id, def.code);
                const row = items.find(
                    (it) =>
                        itemKey(it.section_code, it.item_code) === k
                );
                const declared = Number(row?.amount || 0);
                if (declared <= 0 && (row?.final_amount == null || row?.final_amount === "")) {
                    return;
                }
                map[k] =
                    row?.final_amount != null && row.final_amount !== ""
                        ? row.final_amount
                        : row?.amount ?? "";
            });
        });
        setFinalAmounts(map);
    }, []);

    const loadData = useCallback(
        async (fy) => {
            if (!userId) return;
            setLoading(true);
            setError("");
            try {
                const res = await fetch(
                    `${AUTH_API}/tax-declaration/self/final-proof?financial_year=${encodeURIComponent(fy)}`,
                    { headers: authHeaders() }
                );
                const { ok, data } = await parseApiResponse(res);
                if (!ok || !data.success) {
                    throw new Error(data.message || "Unable to load final proof");
                }
                const reg = normalizeRegime(data.regime || data.declaration?.tax_regime);
                setFinancialYear(data.financial_year || fy);
                setFyOptions((prev) => mergeFinancialYears(prev, [data.financial_year || fy]));
                setSchema(data.schema || {});
                setDeclaration(data.declaration || null);
                setDocuments(data.declaration?.documents || []);
                setEditable(Boolean(data.editable));
                setRegime(reg);
                hydrateFinalAmounts(data.declaration, data.schema, reg);
            } catch (err) {
                setError(err.message || "Unable to load year-end final proof");
                setDeclaration(null);
            } finally {
                setLoading(false);
            }
        },
        [userId, hydrateFinalAmounts]
    );

    useRefreshOnNavigate(() => {
        if (!userId) {
            setLoading(false);
            setError("Please log in.");
            return;
        }
        loadData(defaultFinancialYear());
    }, [userId, loadData]);

    const sectionGroups = useMemo(() => {
        const groups = [];
        (schema?.sections || []).forEach((sec) => {
            if (!sectionVisible(sec, regime)) return;
            const rows = [];
            (sec.items || []).forEach((def) => {
                if (def.type !== "amount" || def.readonly || def.code === "EPF") return;
                const k = itemKey(sec.id, def.code);
                const declItem = (declaration?.items || []).find(
                    (it) => itemKey(it.section_code, it.item_code) === k
                );
                const declared = Number(declItem?.amount || 0);
                const finalVal = finalAmounts[k];
                const hasFinal =
                    finalVal !== "" && finalVal != null && Number(finalVal) > 0;
                if (declared <= 0 && !hasFinal) return;
                rows.push({
                    key: k,
                    section: sec,
                    def,
                    declared,
                    proofRequired: Boolean(def.proof_required),
                });
            });
            if (rows.length > 0) {
                groups.push({ section: sec, rows });
            }
        });
        return groups;
    }, [schema, regime, declaration, finalAmounts]);

    const progress = useMemo(() => {
        let total = 0;
        let done = 0;
        sectionGroups.forEach((g) => {
            g.rows.forEach((row) => {
                total += 1;
                const finalVal = finalAmounts[row.key];
                const hasAmount =
                    finalVal !== "" && finalVal != null && Number(finalVal) >= 0;
                const provDocs = docsForItem(
                    documents,
                    row.section.id,
                    row.def.code
                );
                const finalDocs = docsForItem(
                    documents,
                    row.section.id,
                    row.def.code,
                    FINAL_PROOF_DOC_TYPE
                );
                const needsDoc = row.proofRequired && Number(finalVal || row.declared) > 0;
                const hasDoc = provDocs.length > 0 || finalDocs.length > 0;
                if (hasAmount && (!needsDoc || hasDoc)) {
                    done += 1;
                }
            });
        });
        return { total, done };
    }, [sectionGroups, finalAmounts, documents]);

    const buildItemsPayload = () =>
        sectionGroups.flatMap((g) =>
            g.rows.map((row) => ({
                section_code: g.section.id,
                item_code: row.def.code,
                final_amount:
                    finalAmounts[row.key] === "" || finalAmounts[row.key] == null
                        ? row.declared
                        : Number(finalAmounts[row.key]),
            }))
        );

    const saveFinalProof = async (submit) => {
        setSaving(true);
        try {
            const res = await fetch(`${AUTH_API}/tax-declaration/self/final-proof`, {
                method: "POST",
                headers: { "Content-Type": "application/json", ...authHeaders() },
                body: JSON.stringify({
                    financial_year: financialYear,
                    items: buildItemsPayload(),
                    submit,
                }),
            });
            const { ok, data } = await parseApiResponse(res);
            if (!ok || !data.success) {
                const msg = data.errors?.length
                    ? data.errors.join(" ")
                    : (data.message || "Save failed");
                throw new Error(msg);
            }
            notifySuccess(data.message || (submit ? "Final proof submitted." : "Saved."));
            setDeclaration(data.declaration || declaration);
            setDocuments(data.declaration?.documents || []);
            hydrateFinalAmounts(data.declaration, schema, regime);
        } catch (err) {
            notifyError(err.message || "Unable to save final proof");
        } finally {
            setSaving(false);
        }
    };

    const handleUpload = async (e, sec, def) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const key = itemKey(sec.id, def.code);
        setUploadingKey(key);
        try {
            const fd = new FormData();
            fd.append("financial_year", financialYear);
            fd.append("doc_type", FINAL_PROOF_DOC_TYPE);
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
                const filtered = prev.filter((d) => {
                    const sameItem =
                        String(d.section_code || "").toUpperCase()
                            === String(sec.id).toUpperCase()
                        && String(d.item_code || "").toUpperCase()
                            === String(def.code).toUpperCase();
                    if (!sameItem) return true;
                    return (d.doc_type || "").toLowerCase() !== FINAL_PROOF_DOC_TYPE;
                });
                return [...filtered, data.document];
            });
            notifySuccess("Proof document uploaded.");
        } catch (err) {
            notifyError(err.message || "Upload failed");
        } finally {
            setUploadingKey(null);
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
            notifyError(err.message || "Delete failed");
        }
    };

    const finalProofStatus = declaration?.final_proof_status || "";
    const phase = declaration?.declaration_phase || "provisional";

    return (
        <div className="tax-decl-page">
            <button
                type="button"
                className="tax-decl-back"
                onClick={() => navigate("/tax-declaration")}
            >
                <ArrowLeft size={18} aria-hidden />
                Back to Tax Declaration
            </button>

            <div className="tax-decl-card">
                <div className="tax-decl-header">
                    <div className="tax-decl-header-main">
                        <div className="tax-decl-header-icon tax-decl-header-icon--final-proof">
                            <FileCheck size={22} aria-hidden />
                        </div>
                        <div>
                            <h1>Year-end final proof</h1>
                            <p>
                                FY {financialYear}
                                {finalProofStatus
                                    ? ` · ${statusLabel(finalProofStatus)}`
                                    : ""}
                            </p>
                        </div>
                    </div>
                </div>

                <p className="tax-decl-muted tax-decl-final-proof-intro">
                    Enter actual amounts invested or spent after the financial year ends. Your
                    provisional declaration proofs are shown for reference — upload year-end proof
                    only if amounts changed or you have updated receipts. Finance will review
                    before payroll uses final figures.
                </p>

                <div className="tax-decl-final-proof-toolbar">
                    <label className="tax-decl-field">
                        <span className="tax-decl-label">Financial Year</span>
                        <select
                            className="tax-decl-control"
                            value={financialYear}
                            disabled={loading || saving}
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
                    {progress.total > 0 && (
                        <div className="tax-decl-final-proof-progress">
                            <CheckCircle2 size={16} aria-hidden />
                            <span>
                                {progress.done} of {progress.total} items ready
                            </span>
                        </div>
                    )}
                </div>

                {declaration?.final_proof_rejection_reason && (
                    <div className="tax-decl-banner tax-decl-banner--warn">
                        Rejection reason: {declaration.final_proof_rejection_reason}
                    </div>
                )}

                {loading && <p className="tax-decl-muted">Loading…</p>}
                {error && !loading && (
                    <div className="tax-decl-alert tax-decl-alert--error">{error}</div>
                )}

                {!loading && !error && declaration && (
                    <>
                        <p className="tax-decl-muted">
                            Phase: <strong>{phase}</strong>
                            {finalProofStatus ? ` · Status: ${finalProofStatus}` : ""}
                        </p>

                        {sectionGroups.length === 0 ? (
                            <p className="tax-decl-muted">
                                No declared investment lines need year-end reconciliation for this FY.
                            </p>
                        ) : (
                            sectionGroups.map((group) => (
                                <section key={group.section.id} className="tax-decl-section">
                                    <h2 className="tax-decl-section-title">
                                        {group.section.title || group.section.id}
                                    </h2>
                                    <div className="tax-decl-final-proof-table-wrap">
                                        <table className="tax-decl-final-proof-table">
                                            <thead>
                                                <tr>
                                                    <th>Item</th>
                                                    <th>Declared</th>
                                                    <th>Actual (final)</th>
                                                    <th>Provisional proof</th>
                                                    <th>Year-end proof</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {group.rows.map((row) => {
                                                    const provisionalDocs = docsForItem(
                                                        documents,
                                                        group.section.id,
                                                        row.def.code
                                                    );
                                                    const finalDocs = docsForItem(
                                                        documents,
                                                        group.section.id,
                                                        row.def.code,
                                                        FINAL_PROOF_DOC_TYPE
                                                    );
                                                    const isUploading = uploadingKey === row.key;
                                                    return (
                                                        <tr key={row.key}>
                                                            <td data-label="Item">
                                                                <strong>{row.def.label}</strong>
                                                                {row.proofRequired && (
                                                                    <small className="tax-decl-final-proof-req">
                                                                        Proof required
                                                                    </small>
                                                                )}
                                                            </td>
                                                            <td
                                                                className="tax-decl-final-proof-table__amount"
                                                                data-label="Declared"
                                                            >
                                                                {formatAmount(row.declared)}
                                                            </td>
                                                            <td data-label="Actual (final)">
                                                                <input
                                                                    type="number"
                                                                    min="0"
                                                                    className="tax-decl-control"
                                                                    disabled={!editable || saving}
                                                                    value={
                                                                        finalAmounts[row.key]
                                                                        ?? row.declared
                                                                        ?? ""
                                                                    }
                                                                    onChange={(e) =>
                                                                        setFinalAmounts((prev) => ({
                                                                            ...prev,
                                                                            [row.key]: e.target.value,
                                                                        }))
                                                                    }
                                                                />
                                                            </td>
                                                            <td data-label="Provisional proof">
                                                                {provisionalDocs.length > 0 ? (
                                                                    <div className="tax-decl-final-proof-doc-cell">
                                                                        {provisionalDocs.map((doc) => (
                                                                            <a
                                                                                key={doc.id}
                                                                                href={doc.url}
                                                                                target="_blank"
                                                                                rel="noopener noreferrer"
                                                                                className="tax-decl-final-proof-prov-link"
                                                                            >
                                                                                {doc.original_name || "View"}
                                                                            </a>
                                                                        ))}
                                                                    </div>
                                                                ) : (
                                                                    <span className="tax-decl-muted">—</span>
                                                                )}
                                                            </td>
                                                            <td data-label="Year-end proof">
                                                                {editable ? (
                                                                    <div className="tax-decl-final-proof-doc-cell">
                                                                        <label className="tax-decl-item-upload">
                                                                            <Upload size={14} aria-hidden />
                                                                            {isUploading
                                                                                ? "Uploading…"
                                                                                : finalDocs.length
                                                                                    ? "Replace"
                                                                                    : "Upload"}
                                                                            <input
                                                                                type="file"
                                                                                hidden
                                                                                disabled={isUploading}
                                                                                onChange={(ev) =>
                                                                                    handleUpload(
                                                                                        ev,
                                                                                        group.section,
                                                                                        row.def
                                                                                    )
                                                                                }
                                                                            />
                                                                        </label>
                                                                        {finalDocs.map((doc) => (
                                                                            <div
                                                                                key={doc.id}
                                                                                className="tax-decl-item-doc"
                                                                            >
                                                                                <a
                                                                                    href={doc.url}
                                                                                    target="_blank"
                                                                                    rel="noopener noreferrer"
                                                                                >
                                                                                    {doc.original_name || "View"}
                                                                                </a>
                                                                                <button
                                                                                    type="button"
                                                                                    onClick={() => removeDoc(doc.id)}
                                                                                >
                                                                                    ×
                                                                                </button>
                                                                            </div>
                                                                        ))}
                                                                        {provisionalDocs.length > 0
                                                                            && finalDocs.length === 0 && (
                                                                            <span className="tax-decl-muted tax-decl-final-proof-hint">
                                                                                Provisional proof above is kept unless you upload here.
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                ) : finalDocs.length > 0 ? (
                                                                    finalDocs.map((doc) => (
                                                                        <a
                                                                            key={doc.id}
                                                                            href={doc.url}
                                                                            target="_blank"
                                                                            rel="noopener noreferrer"
                                                                        >
                                                                            {doc.original_name || "View"}
                                                                        </a>
                                                                    ))
                                                                ) : provisionalDocs.length > 0 ? (
                                                                    <span className="tax-decl-muted">
                                                                        Using provisional proof
                                                                    </span>
                                                                ) : (
                                                                    <span className="tax-decl-muted">—</span>
                                                                )}
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                </section>
                            ))
                        )}

                        {editable && sectionGroups.length > 0 && (
                            <div className="tax-decl-actions tax-decl-actions--sticky">
                                <button
                                    type="button"
                                    className="tax-decl-btn tax-decl-btn--secondary"
                                    disabled={saving}
                                    onClick={() => saveFinalProof(false)}
                                >
                                    {saving ? "Saving…" : "Save draft"}
                                </button>
                                <button
                                    type="button"
                                    className="tax-decl-btn tax-decl-btn--primary"
                                    disabled={saving}
                                    onClick={() => saveFinalProof(true)}
                                >
                                    {saving ? "Submitting…" : "Submit final proof"}
                                </button>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}

export default TaxDeclarationFinalProof;
