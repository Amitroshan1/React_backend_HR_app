import { useMemo, useState } from "react";

function currentYear() {
  return new Date().getFullYear();
}

function currentMonthValue() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function emptyMonths(year) {
  const labels = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return labels.map((label, i) => ({
    month: `${year}-${String(i + 1).padStart(2, "0")}`,
    label,
    imports: { shipments: 0, quantity: 0 },
    exports: { shipments: 0, units: 0 },
  }));
}

function yearFromDate(value) {
  const text = String(value || "");
  const match = text.match(/^(\d{4})-(\d{2})/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isFinite(year) || month < 1 || month > 12) return null;
  return { year, month };
}

function summarizeLocal(year, imports, exports) {
  const months = emptyMonths(year);
  for (const row of imports || []) {
    const parsed = yearFromDate(row.date);
    if (!parsed || parsed.year !== year) continue;
    months[parsed.month - 1].imports.shipments += 1;
    months[parsed.month - 1].imports.quantity += Number(row.count || 0);
  }
  for (const row of exports || []) {
    const parsed = yearFromDate(row.date);
    if (!parsed || parsed.year !== year) continue;
    months[parsed.month - 1].exports.shipments += 1;
    months[parsed.month - 1].exports.units += Number(row.count || row.assets?.length || 0);
  }
  const totals = {
    imports: {
      shipments: months.reduce((sum, m) => sum + m.imports.shipments, 0),
      quantity: months.reduce((sum, m) => sum + m.imports.quantity, 0),
    },
    exports: {
      shipments: months.reduce((sum, m) => sum + m.exports.shipments, 0),
      units: months.reduce((sum, m) => sum + m.exports.units, 0),
    },
  };
  return { months, totals };
}

function toCsv(year, months, totals) {
  const header = ["Month", "Import shipments", "Import quantity", "Export shipments", "Export units"];
  const rows = months.map((m) => [
    `${m.label} ${year}`,
    m.imports.shipments,
    m.imports.quantity,
    m.exports.shipments,
    m.exports.units,
  ]);
  rows.push([
    `Total ${year}`,
    totals.imports.shipments,
    totals.imports.quantity,
    totals.exports.shipments,
    totals.exports.units,
  ]);
  return [header, ...rows]
    .map((cols) => cols.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
    .join("\n");
}

function KpiCard({ tone, label, value, hint }) {
  return (
    <article className={`pcl-hist-kpi pcl-hist-kpi--${tone}`}>
      <p className="pcl-hist-kpi-label">{label}</p>
      <p className="pcl-hist-kpi-value">{value}</p>
      <p className="pcl-hist-kpi-hint">{hint}</p>
    </article>
  );
}

export default function ParcelMonthlyHistory({
  imports = [],
  exports = [],
  onOpenMonthLog,
  onOpenMonthRecords,
}) {
  const [year, setYear] = useState(currentYear);
  const thisMonth = currentMonthValue();

  const { months, totals } = useMemo(
    () => summarizeLocal(year, imports, exports),
    [year, imports, exports],
  );
  const activeMonths = useMemo(
    () => months.filter((row) => row.imports.shipments > 0 || row.exports.shipments > 0),
    [months],
  );

  const yearOptions = useMemo(() => {
    const years = new Set([currentYear(), year]);
    for (const row of [...imports, ...exports]) {
      const parsed = yearFromDate(row.date);
      if (parsed) years.add(parsed.year);
    }
    return [...years].sort((a, b) => b - a);
  }, [imports, exports, year]);

  const downloadCsv = () => {
    const blob = new Blob([toCsv(year, activeMonths, totals)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `parcel-monthly-history-${year}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="pcl-hist">
      <div className="pcl-hist-toolbar">
        <div>
          <h2 className="pcl-hist-title">Monthly history</h2>
          <p className="pcl-hist-sub">
            Track how many imports and exports happened in each month.
          </p>
        </div>
        <div className="pcl-hist-actions">
          <label className="pcl-hist-year">
            <span>Year</span>
            <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {yearOptions.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </label>
          <button type="button" className="pcl-hist-csv" onClick={downloadCsv}>
            Download CSV
          </button>
        </div>
      </div>

      <div className="pcl-hist-kpis">
        <KpiCard
          tone="in"
          label="Import shipments"
          value={totals.imports.shipments}
          hint="Incoming parcels"
        />
        <KpiCard
          tone="in"
          label="Import quantity"
          value={totals.imports.quantity}
          hint="Total items received"
        />
        <KpiCard
          tone="out"
          label="Export shipments"
          value={totals.exports.shipments}
          hint="Outgoing parcels"
        />
        <KpiCard
          tone="out"
          label="Export units"
          value={totals.exports.units}
          hint="Assets sent out"
        />
      </div>

      {activeMonths.length === 0 ? (
        <p className="pcl-hist-empty">No import or export records in {year}.</p>
      ) : (
      <div className="pcl-hist-grid">
        {activeMonths.map((row) => {
          const isCurrent = row.month === thisMonth;
          return (
            <article
              key={row.month}
              className={`pcl-hist-card is-active${isCurrent ? " is-current" : ""}`}
            >
              <header className="pcl-hist-card-head">
                <div>
                  <h3>{row.label}</h3>
                  <p>{year}{isCurrent ? " · This month" : ""}</p>
                </div>
              </header>

              <dl className="pcl-hist-stats">
                <div>
                  <dt>Imports</dt>
                  <dd>{row.imports.shipments} <small>shipments</small></dd>
                  <dd className="pcl-hist-qty">{row.imports.quantity} qty</dd>
                </div>
                <div>
                  <dt>Exports</dt>
                  <dd>{row.exports.shipments} <small>shipments</small></dd>
                  <dd className="pcl-hist-qty">{row.exports.units} units</dd>
                </div>
              </dl>

              <div className="pcl-hist-card-actions">
                <button type="button" className="pcl-hist-ghost" onClick={() => onOpenMonthLog(row.month)}>
                  View log
                </button>
                <button type="button" className="pcl-hist-solid" onClick={() => onOpenMonthRecords(row.month)}>
                  View records
                </button>
              </div>
            </article>
          );
        })}
      </div>
      )}
    </section>
  );
}
