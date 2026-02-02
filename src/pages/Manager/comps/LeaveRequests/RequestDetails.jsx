import React, { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import "./RequestDetails.css";

export const RequestDetails = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { request } = location.state || {};
  const [activeDoc, setActiveDoc] = useState(0);
  const [isVisible, setIsVisible] = useState(false);

  const [remarks, setRemarks] = useState(""); 
  const [error, setError] = useState(false);

  const [expenses, setExpenses] = useState(request?.expenses || []);
  const isClaim = request?.type?.toLowerCase().includes("claim");

  // ✅ VALIDATION: Check if every line item has been processed
  const allItemsProcessed = expenses.every(exp => exp.status !== "Pending");

  // ✅ Pagination Logic
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 5;
  const indexOfLastItem = currentPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;
  const currentExpenses = expenses.slice(indexOfFirstItem, indexOfLastItem);
  const totalPages = Math.ceil(expenses.length / itemsPerPage);

  // ✅ Popup State
  const [showModal, setShowModal] = useState(false);
  const [itemToUpdate, setItemToUpdate] = useState(null); 
  const [lineItemRemarks, setLineItemRemarks] = useState("");

  const activeCurrency = expenses.length > 0 ? expenses[0].currency : "INR";
  const totalApproved = expenses
    .filter(exp => exp.status === "Approved")
    .reduce((sum, exp) => sum + parseFloat(exp.amount || 0), 0);

  const testDocs = request?.documents?.length > 0 ? request.documents : [
    "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
    "https://raw.githubusercontent.com/mdn/learning-area/master/html/multimedia-and-embedding/images-in-html/dinosaur_small.jpg",
    "https://pdfobject.com/pdf/sample.pdf"
  ];

  useEffect(() => {
    setIsVisible(true);
  }, []);

  const handleLineItemClick = (e, id, status) => {
    e.preventDefault();
    e.stopPropagation(); 
    setItemToUpdate({ id, status });
    setLineItemRemarks("");
    setShowModal(true);
  };

  const confirmAction = () => {
    if (!lineItemRemarks.trim()) return;

    setExpenses(prev => prev.map(exp => 
      exp.id === itemToUpdate.id ? { ...exp, status: itemToUpdate.status } : exp
    ));
    setShowModal(false);
    setItemToUpdate(null);
  };

  const handleAction = (status) => {
    // Check both: Global remarks AND all table actions
    if (!remarks.trim() || !allItemsProcessed) {
      setError(true);
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
      return;
    }
    navigate("/", { 
      state: { 
        updatedId: request?.id, 
        newStatus: status,
        updatedExpenses: isClaim ? expenses : null 
      } 
    });
  };

  if (!request) return <div className="error-state">Data lost. Please go back.</div>;

  const isImage = (url) => {
    if (!url || typeof url !== 'string') return false;
    return /\.(jpg|jpeg|png|webp|avif|gif)$/.test(url.toLowerCase());
  };

  return (
    <div className={`details-page-wrapper ${isVisible ? "fade-in" : ""}`}>
      <header className="details-top-nav">
        <button className="back-arrow-btn" onClick={() => navigate(-1)}>
          <span className="icon">←</span> Back
        </button>
        <div className="header-meta">
          <h1>{request.employeeName}</h1>
          <span className={`request-badge-pill badge-${request.type?.toLowerCase().split(' ')[0]}`}>
            {request.type}
          </span>
        </div>
      </header>

      <main className="details-main-grid expanded-view">
        <section className="info-column-pane">
          <div className="modern-detail-card slide-up full-height-card">
            <h3 className="card-heading">
              {isClaim ? "Expense Claim Details" : "Request Information"}
            </h3>
            
            <div className="content-static-area">
              {request.details && (
                <div className="claim-metadata-grid">
                  {Object.entries(request.details).map(([key, value]) => (
                    <div className="highlighted-data-field" key={key}>
                      <label className="main-heading-label">{key}</label>
                      <p className="main-heading-value">{value}</p>
                    </div>
                  ))}
                </div>
              )}

              {isClaim ? (
                <div className="expense-table-wrapper">
                  <table className="expense-table">
                    <thead>
                      <tr>
                        <th>Sr.</th>
                        <th>Date</th>
                        <th>Description</th>
                        <th>Currency</th>
                        <th>Amount</th>
                        <th style={{ textAlign: 'center' }}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {currentExpenses.map((exp, index) => {
                        const globalIndex = indexOfFirstItem + index;
                        // ✅ Highlight logic: Apply 'pending-highlight' if row needs action
                        const isPending = exp.status === "Pending";
                        return (
                          <tr 
                            key={exp.id} 
                            className={`${activeDoc === globalIndex ? "row-highlight" : ""} ${isPending && error ? "pending-action-required" : ""}`}
                            onClick={() => setActiveDoc(globalIndex)}
                            style={isPending && error ? { backgroundColor: '#fff5f5' } : {}}
                          >
                            <td>{globalIndex + 1}</td>
                            <td className="date-cell">{exp.date || "N/A"}</td>
                            <td className="desc-cell">{exp.description}</td>
                            <td className="currency-cell">{exp.currency || "INR"}</td>
                            <td className="amount-cell">{exp.amount}</td>
                            <td>
                              {isPending ? (
                                <div className="row-actions" style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                                  <button className="mini-btn approve" onClick={(e) => handleLineItemClick(e, exp.id, "Approved")}>✔</button>
                                  <button className="mini-btn reject" onClick={(e) => handleLineItemClick(e, exp.id, "Rejected")}>✖</button>
                                </div>
                              ) : (
                                <span className={`mini-status ${exp.status.toLowerCase()}`} style={{ display: 'block', textAlign: 'center' }}>{exp.status}</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="total-summary-row">
                        <td colSpan="4" style={{ textAlign: 'right', fontWeight: '700' }}>Total Approved Amount:</td>
                        <td className="total-amount-value" style={{ fontWeight: '800', color: '#10b981' }}>
                           {activeCurrency} {totalApproved.toLocaleString()}
                        </td>
                        <td></td>
                      </tr>
                    </tfoot>
                  </table>

                  {totalPages > 1 && (
  <div className="modern-pagination-container">
    <div className="pagination-pill-list">
      {[...Array(totalPages)].map((_, i) => (
        <button
          key={i + 1}
          className={`page-pill ${currentPage === i + 1 ? "active" : ""}`}
          onClick={() => setCurrentPage(i + 1)}
        >
          {i + 1}
        </button>
      ))}
    </div>

    <button
      className="pagination-next-link"
      disabled={currentPage === totalPages}
      onClick={() => setCurrentPage((prev) => prev + 1)}
    >
      NEXT <span className="chevron">›</span>
    </button>
  </div>
)}
                </div>
              ) : (
                <div className="data-field">
                  <label>Employee Reason</label>
                  <p>{request.reason}</p>
                </div>
              )}
            </div>
            
            <div className="remarks-input-group" style={{ marginTop: '20px' }}>
              <label style={{ color: error && !remarks.trim() ? '#ef4444' : 'inherit', fontWeight: 'bold' }}>
                Admin Decision Remarks <span style={{ color: '#ef4444' }}>*</span>
                {error && !remarks.trim() && <small style={{ marginLeft: '10px', fontWeight: 'normal' }}>(Justification required)</small>}
              </label>
              <textarea 
                placeholder="Type your final justification here..." 
                rows="4" 
                value={remarks}
                onChange={(e) => {
                  setRemarks(e.target.value);
                  if (e.target.value.trim()) setError(false);
                }}
                style={{ borderColor: error && !remarks.trim() ? '#ef4444' : '#ddd' }}
              />
              {error && !allItemsProcessed && (
                <p style={{ color: '#ef4444', fontSize: '0.85rem', marginTop: '8px' }}>
                  ⚠️ Please Approve or Reject all line items in the table above before finalizing.
                </p>
              )}
            </div>
          </div>
        </section>

        <section className="preview-column-pane">
          <div className="modern-detail-card slide-up delay-1 sticky-preview">
            <div className="card-header-flex">
              <h3 className="card-heading">Verification Files ({testDocs.length})</h3>
              <div className="doc-navigation-tabs">
                {testDocs.map((_, i) => (
                  <button key={i} className={activeDoc === i ? "tab-btn active" : "tab-btn"} onClick={() => setActiveDoc(i)}>File {i + 1}</button>
                ))}
              </div>
            </div>
            <div className="iframe-viewport-container">
              {testDocs[activeDoc] ? (
                isImage(testDocs[activeDoc]) ? (
                  <img src={testDocs[activeDoc]} alt="Preview" className="preview-image" />
                ) : (
                  <iframe src={`${testDocs[activeDoc]}#toolbar=0`} title="Preview" style={{ width: '100%', height: '100%', border: 'none' }} />
                )
              ) : (
                <div className="empty-viewport">📄 <p>No document available.</p></div>
              )}
            </div>
          </div>
        </section>
      </main>

      {showModal && (
        <div className="modal-overlay" style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex',
            alignItems: 'center', justifyContent: 'center', zIndex: 9999,
            backdropFilter: 'blur(4px)'
        }}>
          <div className="modal-content" style={{
              backgroundColor: 'white', padding: '24px', borderRadius: '16px',
              width: '400px', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)'
          }}>
            <h3 className="card-heading" style={{ marginTop: 0, color: '#1e293b' }}>Confirm {itemToUpdate?.status}</h3>
            <div className="remarks-input-group">
              <label style={{ fontSize: '0.9rem', marginBottom: '8px', display: 'block' }}>
                Reason for {itemToUpdate?.status?.toLowerCase()} <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <textarea 
                placeholder="Required: Provide a reason for this specific item..."
                rows="4"
                value={lineItemRemarks}
                onChange={(e) => setLineItemRemarks(e.target.value)}
                autoFocus
                style={{ 
                  width: '100%', padding: '12px', borderRadius: '8px', 
                  border: '1px solid #ddd', fontSize: '0.95rem', outline: 'none'
                }}
              />
            </div>
            <div className="modal-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '20px' }}>
              <button className="btn-link" onClick={() => setShowModal(false)} style={{ cursor: 'pointer', background: 'none', border: 'none', color: '#64748b' }}>Cancel</button>
              <button 
                disabled={!lineItemRemarks.trim()}
                className={itemToUpdate?.status === "Approved" ? "btn-solid-success" : "btn-outline-danger"} 
                onClick={confirmAction}
                style={{ 
                  opacity: !lineItemRemarks.trim() ? 0.5 : 1,
                  cursor: !lineItemRemarks.trim() ? 'not-allowed' : 'pointer',
                  padding: '8px 20px',
                  borderRadius: '8px',
                  border: 'none',
                  backgroundColor: itemToUpdate?.status === "Approved" ? '#10b981' : '#ef4444',
                  color: 'white',
                  fontWeight: '600'
                }}
              >
                Confirm {itemToUpdate?.status}
              </button>
            </div>
          </div>
        </div>
      )}

      <footer className="glass-action-footer">
        <button className="btn-link" onClick={() => navigate(-1)}>Cancel</button>
        <div className="btn-group-right">
          <button 
            className="btn-outline-danger" 
            onClick={() => handleAction("Rejected")}
            disabled={!allItemsProcessed || !remarks.trim()}
            style={{ opacity: (!allItemsProcessed || !remarks.trim()) ? 0.5 : 1 }}
          >
            Reject Request
          </button>
          <button 
            className="btn-solid-success" 
            onClick={() => handleAction("Approved")}
            disabled={!allItemsProcessed || !remarks.trim()}
            style={{ opacity: (!allItemsProcessed || !remarks.trim()) ? 0.5 : 1 }}
          >
            Approve Request
          </button>
        </div>
      </footer>
    </div>
  );
}