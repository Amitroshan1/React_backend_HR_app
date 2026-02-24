import { useEffect, useState } from "react";
import "./HolidayCalendarUser.css";

const API_BASE = "/api/HumanResource";

function authHeaders() {
  const token = localStorage.getItem("token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export const HolidayCalendarUser = () => {
  const [year] = useState(new Date().getFullYear());
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const fetchHolidays = async (targetYear) => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`${API_BASE}/holidays/user?year=${targetYear}&auto_seed=1`, {
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

  return (
    <div className="hc-dashboard-container">
      {error && <div className="hc-error">{error}</div>}

      <div className="hc-card hc-calendar-card">
        <div className="hc-card-header">
          <h2 className="hc-section-title">Holiday Calendar {year}</h2>
          <p className="hc-subtitle">Company holiday list for {year}.</p>
        </div>

        <div className="hc-card-body">
          <div className="hc-table-wrap">
            <table className="hc-table">
              <thead>
                <tr>
                  <th>SR. NO.</th>
                  <th>DATE</th>
                  <th>DAY</th>
                  <th>HOLIDAYS</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan="4" className="hc-empty">Loading holidays...</td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan="4" className="hc-empty">No holidays found.</td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr key={row.id}>
                      <td>{row.sr_no}</td>
                      <td>{row.display_date || "-"}</td>
                      <td>{row.day || "-"}</td>
                      <td>
                        {row.holiday_name}
                        {row.is_optional ? " (OPTIONAL)" : ""}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <p className="hc-note">
            <strong>NOTE:</strong> Out of 3 optional holidays, you are eligible to opt any one holiday.
          </p>
        </div>
      </div>
    </div>
  );
};
