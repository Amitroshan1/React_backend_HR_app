import React, { useState, useEffect, useMemo } from "react";
import { fetchTeamMembers } from "../../api";
import "./TeamMembers.css";

const MASTER_OPTIONS_API = "/api/auth/master-options";

export const TeamMembers = ({ filters, setFilters }) => {
  const { circle, type } = filters;

  const [masterCircles, setMasterCircles] = useState([]);
  const [masterTypes, setMasterTypes] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 6;
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (token) {
      fetch(MASTER_OPTIONS_API, { headers: { Authorization: `Bearer ${token}` } })
        .then((res) => res.json().catch(() => ({})))
        .then((data) => {
          if (data.success) {
            if (data.circles?.length) setMasterCircles(data.circles);
            if (data.departments?.length) setMasterTypes(data.departments);
          }
        });
    }
  }, []);

  useEffect(() => {
    setCurrentPage(1);
  }, [circle, type]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const result = await fetchTeamMembers({ circle, type });
        if (cancelled) return;
        setMembers(result.members || []);
      } catch (err) {
        if (cancelled) return;
        setError(err.message || "Failed to load team members");
        setMembers([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [circle, type]);

  const circleOptions = useMemo(() => {
    if (masterCircles.length) return ["All", ...masterCircles];
    return ["All", ...new Set(members.map((m) => m.circle).filter(Boolean))];
  }, [masterCircles, members]);

  const typeOptions = useMemo(() => {
    if (masterTypes.length) return ["All", ...masterTypes];
    return ["All", ...new Set(members.map((m) => m.role).filter(Boolean))];
  }, [masterTypes, members]);

  // 3. ✅ Slicing logic for 6 members
  const indexOfLastItem = currentPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;
  const currentMembers = members.slice(indexOfFirstItem, indexOfLastItem);
  const totalPages = Math.ceil(members.length / itemsPerPage);

  return (
    <div className="team-card">
      <div className="team-header">
        <h3>
          Team Members <span className="count">({members.length})</span>
        </h3>
      </div>

      <div className="team-filters">
        <div>
          <label>Circle</label>
          <select
            value={circle}
            onChange={(e) => setFilters((prev) => ({ ...prev, circle: e.target.value }))}
          >
            {circleOptions.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>

        <div>
          <label>Employee Type</label>
          <select
            value={type}
            onChange={(e) => setFilters((prev) => ({ ...prev, type: e.target.value }))}
          >
            {typeOptions.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
      </div>

      {/* 4. ✅ Render Sliced List (Now exactly 6 rows) */}
      <div className="team-list">
        {loading && <div className="team-empty-msg">Loading team members...</div>}
        {error && !loading && <div className="team-empty-msg">{error}</div>}
        {!loading && !error && currentMembers.length === 0 && (
          <div className="team-empty-msg">No team members found.</div>
        )}
        {!loading && !error && currentMembers.map((m) => (
          <div key={m.id} className="member-row">
            <div className="avatar">{m.name[0]}</div>
            <div className="info">
              <strong>{m.name}</strong>
              <span>{m.role}</span>
            </div>
            <div className="progress">
              <div style={{ width: `${m.perf || 0}%` }} />
            </div>
            <span className={`badge ${m.status === "WFH" ? "wfh" : ""}`}>
              {m.status || "Present"}
            </span>
          </div>
        ))}
      </div>

      {/* 5. ✅ Circular Pagination UI */}
      {totalPages > 1 && (
        <div className="modern-pagination-container">
          <div className="pagination-pill-list">
            {[...Array(totalPages)].map((_, i) => (
              <button
                key={i + 1}
                className={`page-pill ${currentPage === i + 1 ? "active" : ""}`}
                onClick={() => setCurrentPage(i + 1)}
              >
                {i + 1}
              </button>
            ))}
          </div>

          <button
            className="pagination-next-link"
            disabled={currentPage === totalPages}
            onClick={() => setCurrentPage((prev) => prev + 1)}
          >
            NEXT <span className="chevron">›</span>
          </button>
        </div>
      )}
    </div>
  );
}