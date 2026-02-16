import React, { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import "./HolidayCalendar.css";

const API_BASE = "/api/HumanResource";

function authHeaders() {
  const token = localStorage.getItem("token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function getDayNameFromIso(isoDate) {
  if (!isoDate) return "-";
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return "-";
  const names = [
    "SUNDAY",
    "MONDAY",
    "TUESDAY",
    "WEDNESDAY",
    "THURSDAY",
    "FRIDAY",
    "SATURDAY",
  ];
  return names[d.getDay()] || "-";
}

export const HolidayCalendar = ({ onBack }) => {
  const [year, setYear] = useState(2026);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const fetchHolidays = async (targetYear) => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`${API_BASE}/holidays?year=${targetYear}&auto_seed=1`, {
        method: "GET",
        headers: {
          ...authHeaders(),
        },
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.message || "Failed to load holiday list");
      }
      setRows(result.holidays || []);
    } catch (err) {
      setRows([]);
      setError(err.message || "Failed to load holiday list");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHolidays(year);
  }, [year]);

  const handleDateChange = (id, dateValue) => {
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, holiday_date: dateValue } : r))
    );
  };

  const handleSaveRow = async (row) => {
    setSavingId(row.id);
    setError("");
    setSuccess("");
    try {
      const response = await fetch(`${API_BASE}/holidays/${row.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(),
        },
        body: JSON.stringify({
          holiday_date: row.holiday_date,
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.message || "Failed to save holiday date");
      }
      setSuccess(`Updated: ${row.holiday_name}`);
      await fetchHolidays(year);
    } catch (err) {
      setError(err.message || "Failed to save holiday date");
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="holiday-page">
      <button className="btn-back-updates" onClick={onBack}>
        <ArrowLeft size={16} /> Back to Updates
      </button>

      <div className="holiday-card">
        <div className="holiday-header">
          <div>
            <h2>Holiday List for the Year {year}</h2>
            <p>Update holiday dates per year and save each row.</p>
          </div>
          <div className="holiday-year-input">
            <label htmlFor="holiday-year">Year</label>
            <input
              id="holiday-year"
              type="number"
              min="2000"
              max="2100"
              value={year}
              onChange={(e) => {
                const parsed = Number(e.target.value);
                if (!Number.isNaN(parsed) && parsed >= 2000 && parsed <= 2100) {
                  setYear(parsed);
                }
              }}
            />
          </div>
        </div>
        {error && <p className="holiday-msg holiday-error">{error}</p>}
        {success && <p className="holiday-msg holiday-success">{success}</p>}

        <div className="holiday-table-wrap">
          <table className="holiday-table">
            <thead>
              <tr>
                <th>SR. NO.</th>
                <th>DATE</th>
                <th>DAY</th>
                <th>HOLIDAYS</th>
                <th>ACTION</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="5" className="holiday-empty-cell">Loading holidays...</td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan="5" className="holiday-empty-cell">No holidays found for selected year.</td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.sr_no}</td>
                    <td>
                      <input
                        type="date"
                        className="holiday-date-input"
                        value={row.holiday_date || ""}
                        onChange={(e) => handleDateChange(row.id, e.target.value)}
                      />
                    </td>
                    <td>{getDayNameFromIso(row.holiday_date)}</td>
                    <td>
                      {row.holiday_name}
                      {row.is_optional ? " (OPTIONAL)" : ""}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="holiday-save-btn"
                        onClick={() => handleSaveRow(row)}
                        disabled={savingId === row.id}
                      >
                        {savingId === row.id ? "Saving..." : "Save"}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <p className="holiday-note">
          <strong>NOTE:</strong> OUT OF 3 OPTIONAL HOLIDAYS, YOU ARE ELIGIBLE TO OPT ANY ONE HOLIDAY.
        </p>
      </div>
    </div>
  );
};
