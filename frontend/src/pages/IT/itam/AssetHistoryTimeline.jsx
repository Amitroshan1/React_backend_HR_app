import { useCallback, useEffect, useState } from "react";
import { isItamFlagEnabled } from "../../../utils/itamFlags";
import { fetchUnitTimelineAPI, downloadUnitTimelineCsvAPI } from "../Data";
import "./AssetHistoryTimeline.css";

function formatWhen(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return d.toLocaleString();
  } catch {
    return String(iso);
  }
}

/**
 * Asset history timeline panel (P2). Renders nothing useful when flag OFF
 * (parent should hide), but still safe to mount.
 */
export default function AssetHistoryTimeline({
  unitId,
  assetLabel = "Asset",
  embedded = false,
  onClose,
}) {
  const enabled = isItamFlagEnabled("itam_timeline_v1");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [rows, setRows] = useState([]);
  const [latest, setLatest] = useState(null);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 1 });

  const load = useCallback(async () => {
    if (!enabled || !unitId) return;
    setLoading(true);
    setError("");
    try {
      const data = await fetchUnitTimelineAPI(unitId, { q, page, limit: 50 });
      setRows(Array.isArray(data?.transitions) ? data.transitions : []);
      setLatest(data?.latest || null);
      setPagination(data?.pagination || { page: 1, limit: 50, total: 0, totalPages: 1 });
    } catch (err) {
      setError(err?.message || "Could not load timeline");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [enabled, unitId, q, page]);

  useEffect(() => {
    load();
  }, [load]);

  const onExport = async () => {
    try {
      await downloadUnitTimelineCsvAPI(unitId, assetLabel);
    } catch (err) {
      setError(err?.message || "CSV export failed");
    }
  };

  if (!enabled) {
    return (
      <div className="itam-hist">
        <p className="itam-hist-muted">
          Timeline is disabled. Set <code>ITAM_TIMELINE_V1=1</code> on the server.
        </p>
        {onClose ? (
          <button type="button" className="itam-hist-btn" onClick={onClose}>
            Close
          </button>
        ) : null}
      </div>
    );
  }

  const body = (
    <div className={`itam-hist${embedded ? " itam-hist--embedded" : ""}`}>
      <header className="itam-hist-header">
        <div>
          <h3>History</h3>
          <p className="itam-hist-asset">{assetLabel}</p>
          {latest?.remark ? (
            <p className="itam-hist-latest" title={latest.remark}>
              Last: <strong>{latest.actionLabel || latest.actionCode}</strong> — {latest.remark}
            </p>
          ) : null}
        </div>
        <div className="itam-hist-header-actions">
          <button type="button" className="itam-hist-btn" onClick={onExport} disabled={!unitId}>
            Export CSV
          </button>
          {onClose ? (
            <button type="button" className="itam-hist-btn ghost" onClick={onClose}>
              Close
            </button>
          ) : null}
        </div>
      </header>

      <div className="itam-hist-filters">
        <input
          type="search"
          placeholder="Search remarks / actions…"
          value={q}
          onChange={(e) => {
            setPage(1);
            setQ(e.target.value);
          }}
        />
        <button type="button" className="itam-hist-btn ghost" onClick={load} disabled={loading}>
          Refresh
        </button>
      </div>

      {error ? <p className="itam-hist-error">{error}</p> : null}
      {loading ? <p className="itam-hist-muted">Loading…</p> : null}

      {!loading && rows.length === 0 ? (
        <p className="itam-hist-muted">No transition history yet for this asset.</p>
      ) : null}

      <ul className="itam-hist-list">
        {rows.map((t) => (
          <li key={t.id || t.transitionCode} className="itam-hist-item">
            <div className="itam-hist-item-top">
              <span className="itam-hist-action">{t.actionLabel || t.actionCode}</span>
              <span className="itam-hist-when">{formatWhen(t.occurredAt)}</span>
            </div>
            <p className="itam-hist-remark">{t.remark || "—"}</p>
            <div className="itam-hist-meta">
              {(t.fromStatus || t.toStatus) && (
                <span>
                  {t.fromStatus || "—"} → {t.toStatus || "—"}
                </span>
              )}
              {t.actor?.name ? <span>by {t.actor.name}</span> : null}
              {t.conditionGrade ? <span>grade {t.conditionGrade}</span> : null}
              {t.transitionCode ? <span className="mono">{t.transitionCode}</span> : null}
            </div>
          </li>
        ))}
      </ul>

      {pagination.totalPages > 1 ? (
        <div className="itam-hist-pager">
          <button
            type="button"
            className="itam-hist-btn ghost"
            disabled={page <= 1 || loading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Previous
          </button>
          <span>
            Page {pagination.page} / {pagination.totalPages} ({pagination.total} events)
          </span>
          <button
            type="button"
            className="itam-hist-btn ghost"
            disabled={page >= pagination.totalPages || loading}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </button>
        </div>
      ) : null}
    </div>
  );

  if (embedded) return body;

  return (
    <div className="itam-hist-overlay" role="dialog" aria-modal="true">
      <div className="itam-hist-modal">{body}</div>
    </div>
  );
}
