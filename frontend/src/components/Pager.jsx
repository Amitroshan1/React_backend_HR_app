import "./Pager.css";

/** "Showing 26–50 of 132" with previous / next buttons. Hidden when everything fits on one page. */
export default function Pager({ page, pages, total, perPage, onPage, loading = false, noun = "records" }) {
  if (!total || pages <= 1) {
    return total ? (
      <div className="pager">
        <span className="pager-range">
          {total} {noun}
        </span>
      </div>
    ) : null;
  }
  const first = (page - 1) * perPage + 1;
  const last = Math.min(total, page * perPage);
  return (
    <nav className="pager" aria-label="Pagination">
      <span className="pager-range">
        Showing {first}–{last} of {total} {noun}
      </span>
      <div className="pager-controls">
        <button type="button" disabled={loading || page <= 1} onClick={() => onPage(page - 1)}>
          ‹ Prev
        </button>
        <span className="pager-page">
          Page {page} of {pages}
        </span>
        <button type="button" disabled={loading || page >= pages} onClick={() => onPage(page + 1)}>
          Next ›
        </button>
      </div>
    </nav>
  );
}
