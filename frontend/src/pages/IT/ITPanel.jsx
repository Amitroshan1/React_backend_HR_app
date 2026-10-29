import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ClipboardCheck,
  Laptop,
  Ticket,
} from "lucide-react";
import { useRefreshOnNavigate } from "../../hooks/useRefreshOnNavigate";
import AssetsDashboard from "./AssetsPage/AssetsDashboard";
import "../Admin/AdminDashboard.css";
import "./ITPanel.css";

const IT_API = "/api/it";

function authHeaders() {
  const token = localStorage.getItem("token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function Kpi({ loading, label, value, hint, icon, tone, onOpen, badge = 0 }) {
  if (loading) return <div className="admin-dash__kpi admin-dash__kpi--skeleton" aria-hidden />;
  const body = (
    <>
      <div>
        <span className="admin-dash__kpi-label">{label}</span>
        {value != null && value !== "" ? <strong className="admin-dash__kpi-value">{value}</strong> : null}
        {hint ? <span className="admin-dash__kpi-hint">{hint}</span> : null}
      </div>
      <span className={`admin-dash__kpi-icon${tone ? ` admin-dash__kpi-icon--${tone}` : ""}`} aria-hidden>
        {icon}
        {badge > 0 ? (
          <span className="admin-dash__kpi-badge" aria-label={`${badge} pending`}>{badge}</span>
        ) : null}
      </span>
    </>
  );
  if (!onOpen) {
    return <article className="admin-dash__kpi admin-dash__kpi--static">{body}</article>;
  }
  return (
    <button type="button" className="admin-dash__kpi" onClick={onOpen}>
      {body}
    </button>
  );
}

export const ITPanel = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState({});

  const load = useCallback(() => {
    setLoading(true);
    fetch(`${IT_API}/summary`, { headers: authHeaders() })
      .then((res) => res.json().catch(() => ({})).then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (ok && data.success) setSummary(data.summary || {});
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useRefreshOnNavigate(load);

  const n = (key) => Number(summary[key] || 0);
  const assigned = n("assigned_assets");
  const dayUse = n("day_use_assets");
  const tickets = n("open_tickets");
  const noc = n("pending_noc");

  return (
    <section className="admin-dash it-dash">
      <h1 className="admin-dash__sr">IT Management</h1>
      <div className="admin-dash__kpis">
        <Kpi
          loading={loading}
          label="Assigned assets"
          value={assigned.toLocaleString()}
          hint="Currently with employees"
          icon={<Laptop size={20} />}
          onOpen={() => navigate("/it/ActiveDevices")}
        />
        <Kpi
          loading={loading}
          label="Loan assets"
          value={dayUse.toLocaleString()}
          hint="Currently checked out"
          icon={<ClipboardCheck size={20} />}
          tone="ok"
          badge={dayUse}
          onOpen={() => navigate("/it/daily-checkout")}
        />
        <Kpi
          loading={loading}
          label="Open tickets"
          value={tickets.toLocaleString()}
          hint="Support tickets waiting"
          icon={<Ticket size={20} />}
          tone={tickets ? "bad" : undefined}
          onOpen={() => navigate("/it/OpenTicket")}
        />
        <Kpi
          loading={loading}
          label="NOC requests"
          value={noc.toLocaleString()}
          hint={noc === 1 ? "1 IT clearance waiting" : `${noc.toLocaleString()} IT clearances waiting`}
          icon={<Ticket size={20} />}
          tone="info"
          badge={noc}
          onOpen={() => navigate("/it/noc-requests")}
        />
      </div>

      <div className="it-dash__assets">
        <AssetsDashboard embedded />
      </div>
    </section>
  );
};
