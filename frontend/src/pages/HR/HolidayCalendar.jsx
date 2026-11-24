import React, { useState } from "react";
import { useRefreshOnNavigate } from "../../hooks/useRefreshOnNavigate";
import { ArrowLeft, CalendarDays, Pencil, Plus, Trash2 } from "lucide-react";
import "./HolidayCalendar.css";
import { formatDate } from "../../utils/dateFormat";
import { getAccessToken } from "../../utils/authSession";

const API_BASE = "/api/HumanResource";

function authHeaders() {
  const token = getAccessToken();
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
  const [screen, setScreen] = useState("hub");
  const [openCircle, setOpenCircle] = useState(null);
  const [year, setYear] = useState(2026);
  const [rows, setRows] = useState([]);
  const [companyCount, setCompanyCount] = useState(0);
  const [circles, setCircles] = useState([]);
  const [overlayCircles, setOverlayCircles] = useState([]);
  const [showAddCircle, setShowAddCircle] = useState(false);
  const [addCircle, setAddCircle] = useState("");
  const [addCopy, setAddCopy] = useState(true);
  const [addError, setAddError] = useState("");
  const [creatingCircle, setCreatingCircle] = useState(false);
  const [loading, setLoading] = useState(false);
  const [manageMode, setManageMode] = useState(false);
  const [savingId, setSavingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [adding, setAdding] = useState(false);
  const [newHoliday, setNewHoliday] = useState(emptyNewHoliday);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const activeCircle = screen === "circle" ? openCircle || "" : "";

  const fetchHolidays = async (targetYear, circleName = "") => {
    setLoading(true);
    setError("");
    try {
      const qs = new URLSearchParams({
        year: String(targetYear),
        auto_seed: circleName ? "0" : "1",
      });
      if (circleName) qs.set("circle", circleName);
      const response = await fetch(`${API_BASE}/holidays?${qs.toString()}`, {
        method: "GET",
        headers: { ...authHeaders() },
        credentials: "include",
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.message || "Failed to load holiday list");
      }
      const list =
        circleName && Array.isArray(result.resolved) ? result.resolved : result.holidays || [];
      setRows(list);
      if (!circleName) {
        setCompanyCount((result.holidays || []).length);
        if (Array.isArray(result.overlay_circles)) {
          setOverlayCircles(result.overlay_circles);
        }
      }
    } catch (err) {
      setRows([]);
      setError(err.message || "Failed to load holiday list");
    } finally {
      setLoading(false);
    }
  };

  const fetchCircles = async () => {
    try {
      const response = await fetch(`${API_BASE}/master/options`, {
        method: "GET",
        headers: { ...authHeaders() },
        credentials: "include",
      });
      const result = await response.json().catch(() => ({}));
      if (response.ok && result.success) {
        setCircles(Array.isArray(result.circles) ? result.circles : []);
      }
    } catch {
      setCircles([]);
    }
  };

  useRefreshOnNavigate(() => {
    fetchCircles();
    if (screen === "circle" && openCircle) {
      fetchHolidays(year, openCircle);
    } else {
      fetchHolidays(year, "");
    }
  }, [year, screen, openCircle]);

  const goHub = () => {
    setScreen("hub");
    setOpenCircle(null);
    exitManageMode();
    setSuccess("");
    setError("");
    fetchHolidays(year, "");
  };

  const openCircleScreen = (name, holidays) => {
    setOpenCircle(name);
    setScreen("circle");
    if (Array.isArray(holidays)) setRows(holidays);
    exitManageMode();
    setSuccess("");
    setError("");
  };

  const handleCreateCircleCalendar = async (e) => {
    e.preventDefault();
    const name = (addCircle || "").trim();
    if (!name) {
      setAddError("Select a circle.");
      return;
    }
    setCreatingCircle(true);
    setAddError("");
    try {
      const response = await fetch(`${API_BASE}/holidays/circle-calendar`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(),
        },
        credentials: "include",
        body: JSON.stringify({
          year,
          circle: name,
          copy_from_company: addCopy,
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.message || "Failed to add circle calendar");
      }
      if (Array.isArray(result.overlay_circles)) {
        setOverlayCircles(result.overlay_circles);
      }
      setShowAddCircle(false);
      setAddCircle("");
      setAddCopy(true);
      openCircleScreen(name, result.holidays || []);
    } catch (err) {
      setAddError(err.message || "Failed to add circle calendar");
    } finally {
      setCreatingCircle(false);
    }
  };

  const handleDeleteCircleCalendar = async (cal) => {
    if (
      !window.confirm(
        `Remove the custom calendar for ${cal.circle}? That circle will use the company calendar again.`
      )
    ) {
      return;
    }
    setError("");
    try {
      const response = await fetch(`${API_BASE}/holidays/circle-calendar`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(),
        },
        credentials: "include",
        body: JSON.stringify({ year: cal.year, circle: cal.circle }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.message || "Failed to remove circle calendar");
      }
      if (Array.isArray(result.overlay_circles)) {
        setOverlayCircles(result.overlay_circles);
      } else {
        setOverlayCircles((prev) =>
          prev.filter((c) => c.circle.toLowerCase() !== cal.circle.toLowerCase())
        );
      }
      if (openCircle && openCircle.toLowerCase() === cal.circle.toLowerCase()) {
        goHub();
      }
    } catch (err) {
      setError(err.message || "Failed to remove circle calendar");
    }
  };

  const overlayNames = overlayCircles.map((c) => String(c.circle || ""));
  const unusedCircles = circles.filter(
    (name) => !overlayNames.some((c) => c.toLowerCase() === String(name).toLowerCase())
  );

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
    setSavingId(row.id || row.holiday_name);
    setError("");
    setSuccess("");
    try {
      const response = row.id
        ? await fetch(`${API_BASE}/holidays/${row.id}`, {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              ...authHeaders(),
            },
            credentials: "include",
            body: JSON.stringify({
              holiday_date: row.holiday_date,
              circle: activeCircle || row.circle || "",
            }),
          })
        : await fetch(`${API_BASE}/holidays`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...authHeaders(),
            },
            credentials: "include",
            body: JSON.stringify({
              year,
              holiday_name: row.holiday_name,
              holiday_date: row.holiday_date,
              is_optional: row.is_optional,
              circle: activeCircle,
              not_observe: false,
            }),
          });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.message || "Failed to save holiday");
      }
      setSuccess(`Updated: ${row.holiday_name}`);
      await fetchHolidays(year, activeCircle);
    } catch (err) {
      setError(err.message || "Failed to save holiday");
    } finally {
      setSavingId(null);
    }
  };

  const handleToggleObserve = async (row) => {
    const skip = !row.not_observe;
    setSavingId(row.id || row.holiday_name);
    setError("");
    setSuccess("");
    try {
      const response = row.id
        ? await fetch(`${API_BASE}/holidays/${row.id}`, {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              ...authHeaders(),
            },
            credentials: "include",
            body: JSON.stringify({ not_observe: skip, circle: activeCircle }),
          })
        : await fetch(`${API_BASE}/holidays`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...authHeaders(),
            },
            credentials: "include",
            body: JSON.stringify({
              year,
              holiday_name: row.holiday_name,
              holiday_date: row.holiday_date,
              is_optional: !!row.is_optional,
              circle: activeCircle,
              not_observe: skip,
            }),
          });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.message || "Failed to update observe flag");
      }
      setSuccess(skip ? `Not observed: ${row.holiday_name}` : `Observed: ${row.holiday_name}`);
      await fetchHolidays(year, activeCircle);
    } catch (err) {
      setError(err.message || "Failed to update observe flag");
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
        credentials: "include",
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.message || "Failed to delete holiday");
      }
      setSuccess(result.message || `Deleted: ${label}`);
      await fetchHolidays(year, activeCircle);
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
        credentials: "include",
        body: JSON.stringify({
          year,
          holiday_name: name,
          holiday_date: newHoliday.holiday_date,
          is_optional: newHoliday.is_optional,
          circle: activeCircle,
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.message || "Failed to add holiday");
      }
      setSuccess(result.message || `Added: ${name}`);
      setNewHoliday(emptyNewHoliday());
      await fetchHolidays(year, activeCircle);
    } catch (err) {
      setError(err.message || "Failed to add holiday");
    } finally {
      setAdding(false);
    }
  };

  const renderHolidayList = ({ title, subtitle }) => (
    <div className="holiday-page">
      <button type="button" className="btn-back-updates" onClick={goHub}>
        <ArrowLeft size={16} /> Back to calendars
      </button>

      <div className="holiday-card">
        <div className="holiday-header">
          <div>
            <h2>{title}</h2>
            <p>
              {manageMode
                ? "Add new holidays or delete existing ones. Update dates and click Save on each row."
                : subtitle}
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
                  <tr
                    key={row.id || `${row.source}-${row.holiday_name}`}
                    className={`${manageMode ? "holiday-row-manage" : ""} ${row.not_observe ? "holiday-row-skipped" : ""}`}
                  >
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
                          {formatDate(row.holiday_date) || "-"}
                        </span>
                      )}
                    </td>
                    <td>{row.day || getDayNameFromIso(row.holiday_date)}</td>
                    <td>
                      {row.holiday_name}
                      {row.is_optional ? " (OPTIONAL)" : ""}
                      {row.not_observe ? " — not observed" : ""}
                    </td>
                    {manageMode && (
                      <td>
                        <div className="holiday-action-btns">
                          <button
                            type="button"
                            className="holiday-save-btn"
                            onClick={() => handleSaveRow(row)}
                            disabled={savingId === (row.id || row.holiday_name) || deletingId === row.id}
                          >
                            {savingId === (row.id || row.holiday_name) ? "Saving..." : "Save"}
                          </button>
                          {activeCircle && row.source !== "extra" ? (
                            <button
                              type="button"
                              className="holiday-edit-mode-btn"
                              onClick={() => handleToggleObserve(row)}
                              disabled={savingId === (row.id || row.holiday_name)}
                            >
                              {row.not_observe ? "Observe" : "Don't observe"}
                            </button>
                          ) : null}
                          {(row.source === "extra" || !activeCircle) && row.id ? (
                            <button
                              type="button"
                              className="holiday-remove-btn"
                              onClick={() => handleRemoveHoliday(row)}
                              disabled={savingId === (row.id || row.holiday_name) || deletingId === row.id}
                            >
                              <Trash2 size={14} />
                              {deletingId === row.id ? "Deleting..." : "Delete"}
                            </button>
                          ) : null}
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
          {activeCircle
            ? " This circle’s resolved calendar (company list + extras − skipped days) is used for punch and leave."
            : ""}
        </p>
      </div>
    </div>
  );

  if (screen === "hub") {
    return (
      <div className="holiday-page">
        <button type="button" className="btn-back-updates" onClick={onBack}>
          <ArrowLeft size={16} /> Back to Updates
        </button>
        <div className="holiday-hub-head">
          <div>
            <h2>Holiday calendars</h2>
            <p>
              Company calendar applies to every circle unless you add a custom calendar for a client site.
            </p>
          </div>
          <div className="holiday-year-input">
            <label htmlFor="holiday-year-hub">Year</label>
            <input
              id="holiday-year-hub"
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
        {error ? <p className="holiday-msg holiday-error">{error}</p> : null}
        <div className="holiday-hub-grid">
          <button type="button" className="holiday-picker-card" onClick={() => setScreen("company")}>
            <span className="holiday-picker-card__icon" aria-hidden>
              <CalendarDays size={22} />
            </span>
            <strong>Default company calendar</strong>
            <span>
              {loading
                ? "Loading…"
                : `${companyCount} holiday${companyCount === 1 ? "" : "s"} for ${year}. Used unless a circle has its own calendar.`}
            </span>
          </button>
          {overlayCircles.map((cal) => (
            <div key={`${cal.circle}-${year}`} className="holiday-picker-card holiday-picker-card--circle">
              <button
                type="button"
                className="holiday-picker-card__main"
                onClick={() => openCircleScreen(cal.circle)}
              >
                <strong>{cal.circle}</strong>
                <span>
                  {cal.count || 0} overlay holiday{(cal.count || 0) === 1 ? "" : "s"} for {year}
                </span>
              </button>
              <button
                type="button"
                className="holiday-picker-card__delete"
                onClick={() => handleDeleteCircleCalendar({ circle: cal.circle, year })}
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            className="holiday-picker-card holiday-picker-card--add"
            onClick={() => {
              setAddError("");
              setAddCircle(unusedCircles[0] || "");
              setShowAddCircle(true);
            }}
          >
            <span className="holiday-picker-card__icon" aria-hidden>
              <Plus size={22} />
            </span>
            <strong>Add circle calendar</strong>
            <span>Only if a circle follows a client holiday list.</span>
          </button>
        </div>
        {showAddCircle ? (
          <div className="holiday-modal-backdrop" role="presentation" onClick={() => setShowAddCircle(false)}>
            <form
              className="holiday-modal"
              onClick={(e) => e.stopPropagation()}
              onSubmit={handleCreateCircleCalendar}
            >
              <h3>Add circle calendar</h3>
              <p>
                Overlay extras and “don’t observe” flags apply to punch, leave, Excel, and Comp-Off for this circle.
              </p>
              <label>
                Circle
                <select value={addCircle} onChange={(e) => setAddCircle(e.target.value)} required>
                  <option value="">Select circle</option>
                  {unusedCircles.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              </label>
              {unusedCircles.length === 0 ? (
                <p className="holiday-msg">Every circle already has a calendar for {year}, or no circles are set in master data.</p>
              ) : null}
              <label className="holiday-checkbox-label">
                <input type="checkbox" checked={addCopy} onChange={(e) => setAddCopy(e.target.checked)} />
                Copy company holidays as a starting point
              </label>
              {addError ? <p className="holiday-msg holiday-error">{addError}</p> : null}
              <div className="holiday-modal__actions">
                <button type="button" className="holiday-edit-mode-btn" onClick={() => setShowAddCircle(false)}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className="holiday-add-submit-btn"
                  disabled={!unusedCircles.length || creatingCircle}
                >
                  {creatingCircle ? "Adding..." : "Add"}
                </button>
              </div>
            </form>
          </div>
        ) : null}
      </div>
    );
  }

  if (screen === "circle") {
    return renderHolidayList({
      title: `${openCircle} — ${year}`,
      subtitle: "Company holidays plus extras. Use Don’t observe to skip a company holiday for this circle.",
    });
  }

  return renderHolidayList({
    title: `Company holiday list — ${year}`,
    subtitle: "View holiday calendar for the selected year.",
  });
};
