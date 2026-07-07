import React from "react";
import "./QueryListPagination.css";

export function QueryListPagination({
  page,
  totalPages,
  totalCount,
  pageSize,
  onPageChange,
  disabled = false,
}) {
  const safeTotal = Math.max(0, Number(totalCount) || 0);
  const safePage = Math.max(1, Number(page) || 1);
  const safePages = safeTotal === 0 ? 1 : Math.max(1, Number(totalPages) || 1);
  const safePageSize = Math.max(1, Number(pageSize) || 10);

  if (safeTotal <= safePageSize && safePages <= 1) {
    return null;
  }

  const start = safeTotal === 0 ? 0 : (safePage - 1) * safePageSize + 1;
  const end = Math.min(safePage * safePageSize, safeTotal);

  return (
    <div className="query-list-pagination" role="navigation" aria-label="Query list pagination">
      <span className="query-list-pagination-summary">
        {safeTotal > 0 ? `Showing ${start}–${end} of ${safeTotal}` : "No results"}
      </span>
      <div className="query-list-pagination-controls">
        <button
          type="button"
          className="query-list-pagination-btn"
          disabled={disabled || safePage <= 1}
          onClick={() => onPageChange(safePage - 1)}
        >
          Previous
        </button>
        <span className="query-list-pagination-info">
          Page {safePage} of {safePages}
        </span>
        <button
          type="button"
          className="query-list-pagination-btn"
          disabled={disabled || safePage >= safePages}
          onClick={() => onPageChange(safePage + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}
