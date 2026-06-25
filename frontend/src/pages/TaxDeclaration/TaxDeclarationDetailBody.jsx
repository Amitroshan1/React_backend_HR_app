import { useState } from "react";
import { Download } from "lucide-react";
import { formatDateTime as formatDateTimeDDMMYYYY } from "../../utils/dateFormat";
import { notifyError } from "../../utils/notify";
import { docsForItem, FINAL_PROOF_DOC_TYPE, generalDocuments } from "./taxDeclarationCaps";
import {
    downloadDeclarationDocument,
    formatAmount,
    groupItemsBySection,
    itemLabel,
    sectionTitle,
    statusBadgeClass,
} from "./taxDeclarationReviewUtils";

export function TaxDeclarationDetailBody({ decl, schema, employee, history, footer, fileApiBase }) {
    const [downloadingId, setDownloadingId] = useState(null);
    const apiBase = fileApiBase || "/api/accounts";

    if (!decl) return null;

    const itemGroups = groupItemsBySection(decl.items || []);
    const generalDocs = generalDocuments(decl.documents || []);

    const handleDownload = async (doc) => {
        setDownloadingId(doc.id);
        try {
            await downloadDeclarationDocument(doc, { apiBase });
        } catch (err) {
            notifyError(err.message || "Unable to download file");
        } finally {
            setDownloadingId(null);
        }
    };

    return (
        <>
            <div className="tax-decl-info-grid">
                <div><span>Employee</span><strong>{employee?.employee_name || "—"}</strong></div>
                <div><span>Emp ID</span><strong>{employee?.employee_id || "—"}</strong></div>
                <div><span>Department</span><strong>{employee?.department || "—"}</strong></div>
                <div><span>PAN</span><strong>{employee?.pan || "—"}</strong></div>
                <div><span>Financial Year</span><strong>{decl.financial_year}</strong></div>
                <div><span>Tax Regime</span><strong>{(decl.tax_regime || "—").replace(/_/g, " ")}</strong></div>
                <div>
                    <span>Status</span>
                    <strong><span className={statusBadgeClass(decl.status)}>{decl.status}</span></strong>
                </div>
                <div><span>Place</span><strong>{decl.declaration_place || "—"}</strong></div>
                <div>
                    <span>Signed on</span>
                    <strong>{decl.declaration_signed_at || "—"}</strong>
                </div>
                <div>
                    <span>Submitted</span>
                    <strong>
                        {decl.submitted_at ? formatDateTimeDDMMYYYY(decl.submitted_at) : "—"}
                    </strong>
                </div>
                <div>
                    <span>Reviewed</span>
                    <strong>
                        {decl.reviewed_at ? formatDateTimeDDMMYYYY(decl.reviewed_at) : "—"}
                    </strong>
                </div>
                <div><span>80C (extra)</span><strong>{formatAmount(decl.section_80c_extra)}</strong></div>
                <div><span>80D</span><strong>{formatAmount(decl.section_80d)}</strong></div>
                <div><span>Rent (annual)</span><strong>{formatAmount(decl.rent_paid_annual)}</strong></div>
            </div>

            {decl.rejection_reason && (
                <div className="tax-decl-banner tax-decl-banner--warn">
                    Rejection reason: {decl.rejection_reason}
                </div>
            )}

            {itemGroups.length > 0 && (
                <section className="tax-decl-section">
                    <h3 className="tax-decl-section-title">Declared items</h3>
                    {itemGroups.map((group) => (
                        <div key={group.sectionCode} className="tax-decl-history-section-block">
                            <h4 className="tax-decl-history-section-label">
                                {sectionTitle(schema, group.sectionCode)}
                            </h4>
                            <div className="tax-decl-review-table-wrap">
                                <table className="tax-decl-review-table tax-decl-review-table--compact tax-decl-review-table--with-docs">
                                    <thead>
                                        <tr>
                                            <th>Item</th>
                                            <th>Amount / Value</th>
                                            <th>Supporting document</th>
                                            <th>Download</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {group.items.map((it) => {
                                            const itemDocs = docsForItem(
                                                decl.documents,
                                                it.section_code,
                                                it.item_code
                                            );
                                            const finalProofDocs = docsForItem(
                                                decl.documents,
                                                it.section_code,
                                                it.item_code,
                                                FINAL_PROOF_DOC_TYPE
                                            );
                                            const displayDocs =
                                                finalProofDocs.length > 0 ? finalProofDocs : itemDocs;
                                            const amountCell =
                                                it.final_amount != null &&
                                                it.final_amount !== "" &&
                                                it.final_amount !== it.amount ? (
                                                    <>
                                                        {formatAmount(it.amount)} declared →{" "}
                                                        <strong>{formatAmount(it.final_amount)}</strong> actual
                                                    </>
                                                ) : it.amount != null && it.amount !== "" ? (
                                                    formatAmount(it.amount)
                                                ) : (
                                                    it.text_value || "—"
                                                );
                                            return (
                                                <tr key={it.id}>
                                                    <td data-label="Item">
                                                        {itemLabel(schema, it.section_code, it.item_code)}
                                                    </td>
                                                    <td
                                                        className="tax-decl-review-table__amount"
                                                        data-label="Amount / Value"
                                                    >
                                                        {amountCell}
                                                    </td>
                                                    <td
                                                        className="tax-decl-review-table__doc-name"
                                                        data-label="Supporting document"
                                                    >
                                                        {displayDocs.length > 0 ? (
                                                            <div className="tax-decl-item-doc-names">
                                                                {displayDocs.map((doc) => (
                                                                    <span
                                                                        key={doc.id}
                                                                        className="tax-decl-doc-filename"
                                                                        title={doc.original_name || "Document"}
                                                                    >
                                                                        {doc.original_name || "Document"}
                                                                        {(doc.doc_type || "").toLowerCase()
                                                                            === FINAL_PROOF_DOC_TYPE
                                                                            ? " (final proof)"
                                                                            : ""}
                                                                    </span>
                                                                ))}
                                                            </div>
                                                        ) : (
                                                            <span className="tax-decl-muted">—</span>
                                                        )}
                                                    </td>
                                                    <td
                                                        className="tax-decl-review-table__doc-download"
                                                        data-label="Download"
                                                    >
                                                        {displayDocs.length > 0 ? (
                                                            <div className="tax-decl-item-doc-actions">
                                                                {displayDocs.map((doc) => (
                                                                    <button
                                                                        key={doc.id}
                                                                        type="button"
                                                                        className="tax-decl-doc-download-btn tax-decl-doc-download-btn--icon"
                                                                        disabled={downloadingId === doc.id}
                                                                        title={`Download ${doc.original_name || "file"}`}
                                                                        onClick={() => handleDownload(doc)}
                                                                    >
                                                                        <Download size={14} aria-hidden />
                                                                        <span>
                                                                            {downloadingId === doc.id
                                                                                ? "…"
                                                                                : "Download"}
                                                                        </span>
                                                                    </button>
                                                                ))}
                                                            </div>
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
                        </div>
                    ))}
                </section>
            )}

            {generalDocs.length > 0 && (
                <section className="tax-decl-section">
                    <h3 className="tax-decl-section-title">General supporting documents</h3>
                    <ul className="tax-decl-doc-list tax-decl-doc-list--split">
                        {generalDocs.map((doc) => (
                            <li key={doc.id} className="tax-decl-doc-list-row">
                                <span
                                    className="tax-decl-doc-filename"
                                    title={doc.original_name || doc.doc_type}
                                >
                                    {doc.original_name || doc.doc_type}
                                </span>
                                <span className="tax-decl-muted tax-decl-doc-list-type">{doc.doc_type}</span>
                                <button
                                    type="button"
                                    className="tax-decl-doc-download-btn tax-decl-doc-download-btn--icon"
                                    disabled={downloadingId === doc.id}
                                    onClick={() => handleDownload(doc)}
                                >
                                    <Download size={14} aria-hidden />
                                    <span>{downloadingId === doc.id ? "…" : "Download"}</span>
                                </button>
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            {(history || []).length > 0 && (
                <section className="tax-decl-section">
                    <h3 className="tax-decl-section-title">Review timeline</h3>
                    <ol className="tax-decl-history-timeline">
                        {[...(history || [])].reverse().map((entry) => (
                            <li key={entry.id} className="tax-decl-history-timeline-item">
                                <div className="tax-decl-history-timeline-head">
                                    <strong className="tax-decl-history-timeline-action">
                                        {(entry.action || "update").replace(/_/g, " ")}
                                    </strong>
                                    <span className="tax-decl-muted">
                                        {entry.created_at
                                            ? formatDateTimeDDMMYYYY(entry.created_at)
                                            : ""}
                                    </span>
                                </div>
                                {(entry.from_status || entry.to_status) && (
                                    <p className="tax-decl-history-timeline-status">
                                        {entry.from_status || "—"} → {entry.to_status || "—"}
                                    </p>
                                )}
                                {entry.comment && (
                                    <p className="tax-decl-history-timeline-comment">{entry.comment}</p>
                                )}
                            </li>
                        ))}
                    </ol>
                </section>
            )}

            {footer}
        </>
    );
}

export default TaxDeclarationDetailBody;
