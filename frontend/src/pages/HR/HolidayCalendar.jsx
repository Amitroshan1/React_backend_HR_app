import React, { useEffect, useState } from "react";
import { ArrowLeft, Pencil, Trash2 } from "lucide-react";
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

const emptyNewHoliday = () => ({
  holiday_name: "",
  holiday_date: "",
  is_optional: false,
});

export const HolidayCalendar = ({ onBack }) => {
  const [year, setYear] = useState(2026);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [manageMode, setManageMode] = useState(false);
  const [savingId, setSavingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [adding, setAdding] = useState(false);
  const [newHoliday, setNewHoliday] = useState(emptyNewHoliday);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const fetchHolidays = async (targetYear) => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`${API_BASE}/holidays?year=${targetYear}&auto_seed=1`, {
        method: "GET",
        headers: { ...authHeaders() },
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

  const exitManageMode = () => {
    setManageMode(false);
    setNewHoliday(emptyNewHoliday());
    setError("");
  };

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
        body: JSON.stringify({ holiday_date: row.holiday_date }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.message || "Failed to save holiday");
      }
      setSuccess(`Updated: ${row.holiday_name}`);
      await fetchHolidays(year);
    } catch (err) {
      setError(err.message || "Failed to save holiday");
    } finally {
      setSavingId(null);
    }
  };

  const handleRemoveHoliday = async (row) => {
    const label = row.holiday_name || "this holiday";
    if (!window.confirm(`Delete "${label}" from the ${year} calendar?`)) {
      return;
    }

    setDeletingId(row.id);
    setError("");
    setSuccess("");
    try {
      const response = await fetch(`${API_BASE}/holidays/${row.id}`, {
        method: "DELETE",
        headers: { ...authHeaders() },
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.message || "Failed to delete holiday");
      }
      setSuccess(result.message || `Deleted: ${label}`);
      await fetchHolidays(year);
    } catch (err) {
      setError(err.message || "Failed to delete holiday");
    } finally {
      setDeletingId(null);
    }
  };

  const handleAddHoliday = async (e) => {
    e.preventDefault();
    const name = newHoliday.holiday_name.trim();
    if (!name) {
      setError("Holiday name is required");
      return;
    }
    if (!newHoliday.holiday_date) {
      setError("Holiday date is required");
      return;
    }

    setAdding(true);
    setError("");
    setSuccess("");
    try {
      const response = await fetch(`${API_BASE}/holidays`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(),
        },
        body: JSON.stringify({
          year,
          holiday_name: name,
          holiday_date: newHoliday.holiday_date,
          is_optional: newHoliday.is_optional,
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.message || "Failed to add holiday");
      }
      setSuccess(result.message || `Added: ${name}`);
      setNewHoliday(emptyNewHoliday());
      await fetchHolidays(year);
    } catch (err) {
      setError(err.message || "Failed to add holiday");
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="holiday-page">
      <button type="button" className="btn-back-updates" onClick={onBack}>
        <ArrowLeft size={16} /> Back to Updates
      </button>

      <div className="holiday-card">
        <div className="holiday-header">
          <div>
            <h2>Holiday List for the Year {year}</h2>
            <p>
              {manageMode
                ? "Add new holidays or delete existing ones. Update dates and click Save on each row."
                : "View holiday calendar for the selected year."}
            </p>
          </div>
          <div className="holiday-header-actions">
            <button
              type="button"
              className={`holiday-edit-mode-btn ${manageMode ? "holiday-edit-mode-btn--active" : ""}`}
              onClick={() => {
                if (manageMode) {
                  exitManageMode();
                } else {
                  setManageMode(true);
                  setSuccess("");
                  setError("");
                }
              }}
            >
              <Pencil size={16} />
              {manageMode ? "Done" : "Edit"}
            </button>
            <div className="holiday-year-input">
              <label htmlFor="holiday-year">Year</label>
              <input
                id="holiday-year"
                type="number"
                min="2000"
                max="2100"
                value={year}
                disabled={manageMode}
                onChange={(e) => {
                  const parsed = Number(e.target.value);
                  if (!Number.isNaN(parsed) && parsed >= 2000 && parsed <= 2100) {
                    setYear(parsed);
                  }
                }}
              />
            </div>
          </div>
        </div>

        {manageMode && (
          <form className="holiday-add-form" onSubmit={handleAddHoliday}>
            <h3 className="holiday-add-form-title">Add new holiday</h3>
            <div className="holiday-add-form-grid">
              <div className="holiday-add-field">
                <label htmlFor="new-holiday-name">Holiday name</label>
                <input
                  id="new-holiday-name"
                  type="text"
                  placeholder="e.g. COMPANY FOUNDATION DAY"
                  value={newHoliday.holiday_name}
                  onChange={(e) =>
                    setNewHoliday((p) => ({ ...p, holiday_name: e.target.value }))
                  }
                  maxLength={120}
                />
              </div>
              <div className="holiday-add-field">
                <label htmlFor="new-holiday-date">Date</label>
                <input
                  id="new-holiday-date"
                  type="date"
                  value={newHoliday.holiday_date}
                  onChange={(e) =>
                    setNewHoliday((p) => ({ ...p, holiday_date: e.target.value }))
                  }
                />
              </div>
              <div className="holiday-add-field holiday-add-field--check">
                <label className="holiday-checkbox-label">
                  <input
                    type="checkbox"
                    checked={newHoliday.is_optional}
                    onChange={(e) =>
                      setNewHoliday((p) => ({ ...p, is_optional: e.target.checked }))
                    }
                  />
                  Optional holiday
                </label>
              </div>
              <div className="holiday-add-field holiday-add-field--submit">
                <button type="submit" className="holiday-add-submit-btn" disabled={adding}>
                  {adding ? "Adding..." : "Add holiday"}
                </button>
              </div>
            </div>
          </form>
        )}

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
                {manageMode && <th>ACTION</th>}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={manageMode ? 5 : 4} className="holiday-empty-cell">
                    Loading holidays...
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={manageMode ? 5 : 4} className="holiday-empty-cell">
                    No holidays found for selected year.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id} className={manageMode ? "holiday-row-manage" : ""}>
                    <td>{row.sr_no}</td>
                    <td>
                      {manageMode ? (
                        <input
                          type="date"
                          className="holiday-date-input"
                          value={row.holiday_date || ""}
                          onChange={(e) => handleDateChange(row.id, e.target.value)}
                        />
                      ) : (
                        <span className="holiday-date-display">
                          {row.display_date || row.holiday_date || "-"}
                        </span>
                      )}
                    </td>
                    <td>{row.day || getDayNameFromIso(row.holiday_date)}</td>
                    <td>
                      {row.holiday_name}
                      {row.is_optional ? " (OPTIONAL)" : ""}
                    </td>
                    {manageMode && (
                      <td>
                        <div className="holiday-action-btns">
                          <button
                            type="button"
                            className="holiday-save-btn"
                            onClick={() => handleSaveRow(row)}
                            disabled={savingId === row.id || deletingId === row.id}
                          >
                            {savingId === row.id ? "Saving..." : "Save"}
                          </button>
                          <button
                            type="button"
                            className="holiday-remove-btn"
                            onClick={() => handleRemoveHoliday(row)}
                            disabled={savingId === row.id || deletingId === row.id}
                          >
                            <Trash2 size={14} />
                            {deletingId === row.id ? "Deleting..." : "Delete"}
                          </button>
                        </div>
                      </td>
                    )}
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
