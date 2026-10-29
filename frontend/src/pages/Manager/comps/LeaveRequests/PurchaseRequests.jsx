import { useState } from "react";
import { useRefreshOnNavigate } from "../../../../hooks/useRefreshOnNavigate";

const API = "/api/inventory-purchase";

function authHeaders() {
  const token = localStorage.getItem("token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function readJson(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) {
    throw new Error(data.message || "Request failed");
  }
  return data;
}

export const PurchaseRequests = ({ statusFilter = "Pending", onRequestUpdated }) => {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [actingId, setActingId] = useState(null);
  const [remarks, setRemarks] = useState({});

  const load = async () => {
    const data = await readJson(await fetch(`${API}?inbox=manager`, { headers: authHeaders() }));
    let rows = data.requests || [];
    const filter = (statusFilter || "Pending").toLowerCase();
    if (filter === "pending") rows = rows.filter((row) => row.status === "pending_manager");
    setRequests(rows);
  };

  useRefreshOnNavigate(() => {
    setLoading(true);
    load()
      .catch((err) => {
        setError(err.message || "Unable to load purchase requests");
        setRequests([]);
      })
      .finally(() => setLoading(false));
  }, [statusFilter]);

  const act = async (id, action) => {
    try {
      setActingId(id);
      await readJson(await fetch(`${API}/${id}/manager-action`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ action, remarks: remarks[id] || "" }),
      }));
      if (onRequestUpdated) await onRequestUpdated();
      await load();
    } catch (err) {
      setError(err.message || "Unable to update this request");
    } finally {
      setActingId(null);
    }
  };

  if (loading) return <p>Loading purchase requests...</p>;
  if (error) return <p>{error}</p>;
  if (!requests.length) return <p>No purchase requests waiting on you.</p>;

  return (
    <>
      {requests.map((row) => (
        <article key={row.id} className="request-card" style={{ padding: 16, marginBottom: 12, border: "1px solid #dce6e4", borderRadius: 12, background: "#fff" }}>
          <strong>{row.request_no} · {row.title}</strong>
          <p style={{ margin: "6px 0", color: "#5b6b7c" }}>
            {row.source_label || "Inventory"} · {row.requested_by_name} · {row.item_name || row.category} · Qty {row.quantity} · {row.status_label}
          </p>
          <p>{row.justification}</p>
          {row.attachments?.length ? (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
              {row.attachments.map((file) => (
                <a key={file.url || file.name} href={file.url} target="_blank" rel="noreferrer">{file.name}</a>
              ))}
            </div>
          ) : null}
          <textarea
            placeholder="Remark (required to reject)"
            value={remarks[row.id] || ""}
            onChange={(e) => setRemarks((current) => ({ ...current, [row.id]: e.target.value }))}
            rows={2}
            style={{ width: "100%", marginBottom: 8 }}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" disabled={actingId === row.id} onClick={() => act(row.id, "approve")}>Confirm need</button>
            <button type="button" disabled={actingId === row.id} onClick={() => act(row.id, "reject")}>Reject</button>
          </div>
        </article>
      ))}
    </>
  );
};
