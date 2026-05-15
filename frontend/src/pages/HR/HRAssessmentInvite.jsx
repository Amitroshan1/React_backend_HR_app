import React, { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ShieldAlert, Trash2 } from "lucide-react";

const HR_API_BASE = "/api/HumanResource";

const getAuthHeaders = () => {
  const token = localStorage.getItem("token");
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const STATUS_STYLES = {
  invited: { bg: "#eff6ff", fg: "#1d4ed8", border: "#bfdbfe", label: "Invited" },
  started: { bg: "#fffbeb", fg: "#b45309", border: "#fde68a", label: "In Progress" },
  submitted: { bg: "#f0fdf4", fg: "#15803d", border: "#bbf7d0", label: "Submitted" },
  disqualified: { bg: "#fef2f2", fg: "#b91c1c", border: "#fecaca", label: "Disqualified" },
  evaluated: { bg: "#f5f3ff", fg: "#6d28d9", border: "#ddd6fe", label: "Evaluated" },
};

function formatIntegrityTimestamp(iso) {
  if (iso == null || String(iso).trim() === "") return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleString();
}

function hasIntegrityContent(inv) {
  if (!inv || typeof inv !== "object") return false;
  const n = (k) => {
    const v = inv[k];
    const x = Number(v);
    return Number.isFinite(x) && x > 0;
  };
  const arr = (k) => Array.isArray(inv[k]) && inv[k].length > 0;
  return (
    !!inv.disqualified ||
    arr("tab_hide_timestamps_utc") ||
    n("tab_hide_count") ||
    arr("window_blur_timestamps_utc") ||
    n("window_blur_count") ||
    arr("paste_attempt_timestamps_utc") ||
    n("paste_attempt_count") ||
    n("clipboard_shortcut_blocks") ||
    n("context_menu_blocks")
  );
}

function IntegrityListBadges({ summary }) {
  if (!summary) {
    return <span style={{ color: "#94a3b8", fontSize: 12 }}>—</span>;
  }
  const chip = (label, fg, bg, border) => (
    <span
      key={label}
      style={{
        display: "inline-block",
        fontSize: 11,
        fontWeight: 700,
        padding: "2px 8px",
        borderRadius: 9999,
        color: fg,
        background: bg,
        border: `1px solid ${border}`,
      }}
    >
      {label}
    </span>
  );
  const out = [];
  if (summary.disqualified) out.push(chip("Disqualified", "#991b1b", "#fef2f2", "#fecaca"));
  if (summary.tab_hide_count > 0) out.push(chip(`Tab ${summary.tab_hide_count}`, "#9a3412", "#ffedd5", "#fdba74"));
  if (summary.window_blur_count > 0) out.push(chip(`Blur ${summary.window_blur_count}`, "#6b21a8", "#f3e8ff", "#d8b4fe"));
  if (summary.paste_attempt_count > 0) out.push(chip(`Paste ${summary.paste_attempt_count}`, "#1e3a8a", "#dbeafe", "#93c5fd"));
  if (summary.clipboard_shortcut_blocks > 0) out.push(chip(`Keys ${summary.clipboard_shortcut_blocks}`, "#854d0e", "#fef9c3", "#fde047"));
  if (summary.context_menu_blocks > 0) out.push(chip(`Menu ${summary.context_menu_blocks}`, "#0f766e", "#ccfbf1", "#5eead4"));
  if (out.length === 0) return <span style={{ color: "#94a3b8", fontSize: 12 }}>—</span>;
  return <span style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>{out}</span>;
}

function IntegrityReviewPanel({ integrity }) {
  if (!hasIntegrityContent(integrity)) return null;

  const tabTs = Array.isArray(integrity.tab_hide_timestamps_utc) ? integrity.tab_hide_timestamps_utc : [];
  const blurTs = Array.isArray(integrity.window_blur_timestamps_utc) ? integrity.window_blur_timestamps_utc : [];
  const pasteTs = Array.isArray(integrity.paste_attempt_timestamps_utc) ? integrity.paste_attempt_timestamps_utc : [];
  const tabN = Number(integrity.tab_hide_count) || tabTs.length;
  const blurN = Number(integrity.window_blur_count) || blurTs.length;
  const pasteN = Number(integrity.paste_attempt_count) || pasteTs.length;
  const clipN = Number(integrity.clipboard_shortcut_blocks) || 0;
  const ctxN = Number(integrity.context_menu_blocks) || 0;
  const dq = !!integrity.disqualified;

  const stat = (label, value, hint) => (
    <div
      key={label}
      style={{
        border: "1px solid #e2e8f0",
        borderRadius: 8,
        padding: "8px 10px",
        background: "#fff",
      }}
    >
      <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color: "#0f172a", marginTop: 2 }}>{value}</div>
      {hint ? <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>{hint}</div> : null}
    </div>
  );

  const tsBlock = (title, items) => (
    <details style={{ marginTop: 8, border: "1px solid #e2e8f0", borderRadius: 8, padding: "6px 10px", background: "#fafafa" }}>
      <summary style={{ cursor: "pointer", fontWeight: 600, fontSize: 13, color: "#334155" }}>
        {title} ({items.length})
      </summary>
      {items.length === 0 ? (
        <p style={{ margin: "8px 0 0", fontSize: 12, color: "#94a3b8" }}>None recorded.</p>
      ) : (
        <ol style={{ margin: "8px 0 0", paddingLeft: 20, fontSize: 12, color: "#475569", maxHeight: 160, overflow: "auto" }}>
          {items.map((t, i) => (
            <li key={`${title}-${i}`}>{formatIntegrityTimestamp(t)}</li>
          ))}
        </ol>
      )}
    </details>
  );

  return (
    <div
      style={{
        marginBottom: 16,
        padding: "14px 16px",
        borderRadius: 10,
        border: dq ? "1px solid #fecaca" : "1px solid #cbd5e1",
        background: dq ? "#fff1f2" : "#f8fafc",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <ShieldAlert size={20} color={dq ? "#b91c1c" : "#475569"} aria-hidden />
        <strong style={{ fontSize: 15, color: "#0f172a" }}>Proctoring &amp; integrity</strong>
        {dq ? (
          <span
            style={{
              marginLeft: 4,
              fontSize: 11,
              fontWeight: 800,
              textTransform: "uppercase",
              padding: "2px 8px",
              borderRadius: 6,
              background: "#b91c1c",
              color: "#fff",
            }}
          >
            Disqualified attempt
          </span>
        ) : null}
      </div>
      <p style={{ margin: "0 0 10px", fontSize: 13, color: "#475569", lineHeight: 1.45 }}>
        Logged automatically during the test (tab visibility, window focus, paste, keyboard shortcuts, and context menu). Timestamps are from the candidate&apos;s browser in UTC where provided.
      </p>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
          gap: 8,
        }}
      >
        {stat("Tab hides", tabN, "Leaving the assessment tab / hidden document")}
        {stat("Window blur", blurN, "Focus left window while tab still visible")}
        {stat("Paste blocked", pasteN, "Paste attempts")}
        {stat("Copy/cut keys", clipN, "Ctrl/Cmd+C/V/X blocked")}
        {stat("Right-click", ctxN, "Context menu blocked")}
      </div>
      {tsBlock("Tab hide times (UTC)", tabTs)}
      {tsBlock("Window blur times (UTC)", blurTs)}
      {tsBlock("Paste attempt times (UTC)", pasteTs)}
      <details style={{ marginTop: 10 }}>
        <summary style={{ cursor: "pointer", fontSize: 12, color: "#64748b" }}>Raw integrity JSON</summary>
        <pre
          style={{
            margin: "8px 0 0",
            padding: 10,
            background: "#0f172a",
            color: "#e2e8f0",
            borderRadius: 8,
            fontSize: 11,
            overflow: "auto",
            maxHeight: 220,
          }}
        >
          {JSON.stringify(integrity, null, 2)}
        </pre>
      </details>
    </div>
  );
}

export function HRAssessmentInvite({ onBack, empTypeOptions = [] }) {
  const [form, setForm] = useState({ full_name: "", email: "", department: empTypeOptions[0] || "" });
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState("success");
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);
  const [marks, setMarks] = useState({});
  const [evaluating, setEvaluating] = useState(false);
  const [recordingVideoUrl, setRecordingVideoUrl] = useState(null);
  const [recordingLoading, setRecordingLoading] = useState(false);
  const [recordingError, setRecordingError] = useState("");
  const [selfiePreviewUrl, setSelfiePreviewUrl] = useState(null);
  const [selfieLoading, setSelfieLoading] = useState(false);
  const [selfieError, setSelfieError] = useState("");

  const fetchRows = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${HR_API_BASE}/assessment/invites`, { headers: getAuthHeaders() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.message || "Failed to load invites");
      setRows(data.invites || []);
    } catch (e) {
      setError(e.message || "Failed to load invites");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selected?.id || !selected?.has_recording) {
      setRecordingVideoUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      setRecordingLoading(false);
      setRecordingError("");
      return undefined;
    }
    let objectUrl = null;
    let cancelled = false;
    setRecordingLoading(true);
    setRecordingError("");
    setRecordingVideoUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    fetch(`${HR_API_BASE}/assessment/invites/${selected.id}/recording`, { headers: getAuthHeaders() })
      .then((res) => {
        if (!res.ok) {
          return res.json().then((j) => {
            throw new Error(j.message || `HTTP ${res.status}`);
          }).catch(() => {
            throw new Error(`Unable to load recording (${res.status})`);
          });
        }
        return res.blob();
      })
      .then((blob) => {
        if (cancelled || !blob || blob.size === 0) return;
        objectUrl = URL.createObjectURL(blob);
        setRecordingVideoUrl(objectUrl);
      })
      .catch((e) => {
        if (!cancelled) setRecordingError(e.message || "Failed to load recording");
      })
      .finally(() => {
        if (!cancelled) setRecordingLoading(false);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [selected?.id, selected?.has_recording]);

  useEffect(() => {
    if (!selected?.id || !selected?.has_selfie) {
      setSelfiePreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      setSelfieLoading(false);
      setSelfieError("");
      return undefined;
    }
    let objectUrl = null;
    let cancelled = false;
    setSelfieLoading(true);
    setSelfieError("");
    setSelfiePreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    fetch(`${HR_API_BASE}/assessment/invites/${selected.id}/selfie`, { headers: getAuthHeaders() })
      .then((res) => {
        if (!res.ok) {
          return res.json().then((j) => {
            throw new Error(j.message || `HTTP ${res.status}`);
          }).catch(() => {
            throw new Error(`Unable to load photo (${res.status})`);
          });
        }
        return res.blob();
      })
      .then((blob) => {
        if (cancelled || !blob || blob.size === 0) return;
        objectUrl = URL.createObjectURL(blob);
        setSelfiePreviewUrl(objectUrl);
      })
      .catch((e) => {
        if (!cancelled) setSelfieError(e.message || "Failed to load verification photo");
      })
      .finally(() => {
        if (!cancelled) setSelfieLoading(false);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [selected?.id, selected?.has_selfie]);

  const handleSend = async (e) => {
    e.preventDefault();
    setError("");
    setMessage("");
    setMessageType("success");
    setSubmitting(true);
    try {
      const res = await fetch(`${HR_API_BASE}/assessment/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.message || "Failed to send invite");
      const mailSent = data.email_sent !== false;
      const providerMsg = String(data.email_provider_message || "").trim();
      const baseMsg = data.message || (mailSent ? "Assessment invite sent successfully." : "Invite created, but email delivery failed.");
      setMessage(providerMsg ? `${baseMsg} (${providerMsg})` : baseMsg);
      setMessageType(mailSent ? "success" : "warning");
      setForm((p) => ({ ...p, full_name: "", email: "" }));
      await fetchRows();
    } catch (e2) {
      setError(e2.message || "Failed to send invite");
    } finally {
      setSubmitting(false);
    }
  };

  const openSubmission = async (id) => {
    setError("");
    try {
      const res = await fetch(`${HR_API_BASE}/assessment/invites/${id}`, { headers: getAuthHeaders() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.message || "Failed to load submission");
      const invite = data.invite || null;
      setSelected(invite);
      const existing = invite?.manual_marks || {};
      setMarks(existing);
    } catch (e) {
      setError(e.message || "Failed to load submission");
    }
  };

  const handleEvaluate = async () => {
    if (!selected?.id) return;
    setEvaluating(true);
    setError("");
    setMessageType("success");
    try {
      const res = await fetch(`${HR_API_BASE}/assessment/invites/${selected.id}/evaluate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ marks }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.message || "Failed to evaluate");
      await openSubmission(selected.id);
      await fetchRows();
      setMessage("Evaluation saved.");
    } catch (e) {
      setError(e.message || "Failed to evaluate");
    } finally {
      setEvaluating(false);
    }
  };

  const handleDeleteInvite = async (inviteRow) => {
    if (!inviteRow?.id) return;
    const ok = window.confirm(`Delete invite for ${inviteRow.full_name || "candidate"}? This cannot be undone.`);
    if (!ok) return;
    setError("");
    setMessage("");
    setMessageType("success");
    try {
      const res = await fetch(`${HR_API_BASE}/assessment/invites/${inviteRow.id}`, {
        method: "DELETE",
        headers: getAuthHeaders(),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.message || "Failed to delete invite");
      setMessage(data.message || "Invite deleted.");
      if (selected?.id === inviteRow.id) {
        setSelected(null);
      }
      await fetchRows();
    } catch (e) {
      setError(e.message || "Failed to delete invite");
    }
  };

  const sec2ObjectiveQs = useMemo(() => Array.from({ length: 8 }, (_, i) => i + 26), []);
  const sec2ManualQs = useMemo(() => Array.from({ length: 29 }, (_, i) => i + 34), []);
  const sec1Qs = useMemo(() => Array.from({ length: 25 }, (_, i) => i + 1), []);
  const sec3Qs = useMemo(() => Array.from({ length: 25 }, (_, i) => i + 63), []);
  const manualDraftTotal = useMemo(
    () =>
      sec2ManualQs.reduce((sum, q) => {
        const raw = marks[String(q)];
        const num = Number(raw);
        return sum + (Number.isFinite(num) ? Math.max(0, num) : 0);
      }, 0),
    [marks, sec2ManualQs]
  );
  const objectiveMax = sec1Qs.length + sec2ObjectiveQs.length + sec3Qs.length;
  const overallMax = objectiveMax + sec2ManualQs.length;

  const getObjectiveQuestionsByNumbers = (questionNumbers) => {
    const sections = selected?.questions || {};
    const all = [...(sections.section_1 || []), ...(sections.section_2 || []), ...(sections.section_3 || [])];
    const wanted = new Set(questionNumbers.map((n) => Number(n)));
    return all.filter((q) => wanted.has(Number(q.number)));
  };

  const renderObjectiveSection = (questionNumbers, title) => (
    <div style={{ marginTop: 14 }}>
      <h4 style={{ margin: "0 0 8px" }}>{title}</h4>
      <div style={{ maxHeight: 190, overflow: "auto", border: "1px solid #e5e7eb", borderRadius: 8, padding: 8 }}>
        {getObjectiveQuestionsByNumbers(questionNumbers).map((q) => {
          const qNo = Number(q.number);
          const b = (selected?.auto_breakdown || {})[String(qNo)] || {};
          const optionList = Array.isArray(q.options) ? q.options : [];
          const givenIdx = b.given == null ? null : Number(b.given);
          const expectedVal = b.expected;
          const expectedIdx = typeof expectedVal === "number" ? expectedVal : Number(expectedVal);
          const givenText = givenIdx && optionList[givenIdx - 1] ? `${givenIdx}. ${optionList[givenIdx - 1]}` : (b.given == null ? "-" : String(b.given));
          const expectedText =
            expectedVal === "Any selected option"
              ? "Any selected option"
              : (expectedIdx && optionList[expectedIdx - 1] ? `${expectedIdx}. ${optionList[expectedIdx - 1]}` : (expectedVal == null ? "-" : String(expectedVal)));
          const correct = !!b.correct;
          return (
            <div
              key={qNo}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 260px",
                gap: 10,
                alignItems: "start",
                padding: "10px 8px",
                borderBottom: "1px solid #f1f5f9",
                background: "#fff",
                borderRadius: 8,
                marginBottom: 8,
              }}
            >
              <div>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>Q{qNo}. {q.question}</div>
                {optionList.length > 0 && (
                  <div style={{ color: "#475569", fontSize: 13 }}>
                    {optionList.map((opt, idx) => {
                      const optNo = idx + 1;
                      const isChosen = givenIdx === optNo;
                      const isExpected =
                        expectedVal !== "Any selected option" && expectedIdx === optNo;
                      const chosenCorrect = isChosen && correct;
                      const chosenWrong = isChosen && !correct;
                      return (
                        <div
                          key={idx}
                          style={{
                            marginBottom: 3,
                            padding: "2px 6px",
                            borderRadius: 6,
                            border: isChosen ? "1px solid" : "1px solid transparent",
                            borderColor: chosenCorrect
                              ? "#86efac"
                              : chosenWrong
                                ? "#fca5a5"
                                : isExpected
                                  ? "#bfdbfe"
                                  : "transparent",
                            background: chosenCorrect
                              ? "#f0fdf4"
                              : chosenWrong
                                ? "#fef2f2"
                                : isExpected
                                  ? "#eff6ff"
                                  : "transparent",
                            color: chosenCorrect
                              ? "#166534"
                              : chosenWrong
                                ? "#b91c1c"
                                : "#475569",
                            fontWeight: isChosen ? 700 : 500,
                          }}
                        >
                          {optNo}. {opt}
                          {isChosen ? (chosenCorrect ? "  (Chosen - Correct)" : "  (Chosen)") : ""}
                          {!isChosen && isExpected ? "  (Expected)" : ""}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              <div
                style={{
                  border: "1px solid #e2e8f0",
                  borderRadius: 8,
                  padding: "8px 10px",
                  background: "#f8fafc",
                  fontSize: 13,
                }}
              >
                <div><strong>Expected:</strong> {expectedText}</div>
                <div style={{ marginTop: 4 }}><strong>Chosen:</strong> {givenText}</div>
                <div style={{ marginTop: 6, fontWeight: 700, color: correct ? "#15803d" : "#b91c1c" }}>
                  {correct ? "Correct" : "Wrong"}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  const renderStatusBadge = (statusValue) => {
    const key = String(statusValue || "").toLowerCase();
    const style = STATUS_STYLES[key] || {
      bg: "#f8fafc",
      fg: "#334155",
      border: "#cbd5e1",
      label: statusValue || "Unknown",
    };
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          padding: "3px 10px",
          borderRadius: 9999,
          fontWeight: 700,
          fontSize: 12,
          border: `1px solid ${style.border}`,
          background: style.bg,
          color: style.fg,
          textTransform: "uppercase",
          letterSpacing: "0.02em",
        }}
      >
        {style.label}
      </span>
    );
  };

  if (selected) {
    return (
      <div className="hr-main-container" style={{ maxWidth: 1200, margin: "0 auto" }}>
        <button className="btn-back-updates" onClick={() => setSelected(null)}>
          <ArrowLeft size={16} /> Back to Invite List
        </button>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 20,
            flexWrap: "wrap",
            marginTop: 8,
          }}
        >
          <div style={{ flex: "1 1 260px", minWidth: 0 }}>
            <h2 style={{ margin: 0 }}>Review Submission</h2>
            <p style={{ color: "#64748b", margin: "8px 0 0" }}>
              {selected.full_name} ({selected.candidate_email})
            </p>
            <p style={{ margin: "8px 0 0" }}>
              Status: {selected.status} | Submitted:{" "}
              {selected.submitted_at ? new Date(selected.submitted_at).toLocaleString() : "-"}
            </p>
          </div>
          <div style={{ flex: "0 0 auto", textAlign: "right", alignSelf: "flex-start" }}>
            {selfieLoading ? (
              <p style={{ fontSize: 12, color: "#64748b", margin: 0 }}>Loading photo…</p>
            ) : null}
            {selfieError ? (
              <p style={{ fontSize: 12, color: "#b91c1c", margin: 0, maxWidth: 200 }}>{selfieError}</p>
            ) : null}
            {selfiePreviewUrl ? (
              <figure style={{ margin: 0 }}>
                <img
                  src={selfiePreviewUrl}
                  alt="Candidate verification photo taken before the test started"
                  style={{
                    width: 140,
                    height: 140,
                    objectFit: "cover",
                    borderRadius: 10,
                    border: "2px solid #e2e8f0",
                    boxShadow: "0 4px 14px rgba(15, 23, 42, 0.1)",
                    display: "block",
                    marginLeft: "auto",
                  }}
                />
                <figcaption style={{ fontSize: 11, color: "#64748b", marginTop: 6 }}>
                  Pre-test verification photo
                </figcaption>
              </figure>
            ) : !selected.has_selfie ? (
              <span style={{ fontSize: 12, color: "#94a3b8" }}>No verification photo</span>
            ) : null}
          </div>
        </div>

        <IntegrityReviewPanel integrity={selected.integrity} />

        {selected.has_recording ? (
          <div
            style={{
              marginBottom: 16,
              padding: "14px 16px",
              borderRadius: 10,
              border: "1px solid #cbd5e1",
              background: "#f8fafc",
            }}
          >
            <strong style={{ fontSize: 15, color: "#0f172a", display: "block", marginBottom: 8 }}>
              Session recording (HR only)
            </strong>
            <p style={{ margin: "0 0 10px", fontSize: 13, color: "#475569" }}>
              Video captured from the candidate&apos;s camera and microphone during the test until submit.
            </p>
            {recordingLoading ? <p style={{ fontSize: 13, color: "#64748b" }}>Loading recording…</p> : null}
            {recordingError ? <p style={{ fontSize: 13, color: "#b91c1c" }}>{recordingError}</p> : null}
            {recordingVideoUrl ? (
              <video
                key={recordingVideoUrl}
                src={recordingVideoUrl}
                controls
                playsInline
                style={{ width: "100%", maxHeight: 420, borderRadius: 8, background: "#000" }}
              />
            ) : null}
          </div>
        ) : selected.status === "submitted" || selected.status === "disqualified" ? (
          <p style={{ fontSize: 13, color: "#94a3b8", marginBottom: 16 }}>No session recording file for this attempt.</p>
        ) : null}

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, minmax(140px, 1fr))",
            gap: 10,
            background: "#f8fafc",
            border: "1px solid #e5e7eb",
            borderRadius: 8,
            padding: 10,
            marginBottom: 10,
          }}
        >
          <div><strong>Objective Score</strong><br />{selected.auto_score ?? 0} / {objectiveMax}</div>
          <div><strong>Manual Score (draft)</strong><br />{manualDraftTotal.toFixed(2)} / {sec2ManualQs.length}</div>
          <div><strong>Current Total</strong><br />{selected.total_score ?? 0} / {overallMax}</div>
          <div><strong>Current Avg %</strong><br />{selected.avg_score ?? 0}%</div>
        </div>

        {renderObjectiveSection(sec1Qs, "Section 1 (Q1-Q25) Auto Analysis")}
        {renderObjectiveSection(sec2ObjectiveQs, "Section 2A (Q26-Q33) Auto Analysis")}
        {renderObjectiveSection(sec3Qs, "Section 3 (Q63-Q87) Auto Analysis")}

        <h4 style={{ marginTop: 16, marginBottom: 8 }}>Section 2B (Q34-Q62) Manual Marks</h4>
        <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 8, background: "#fff" }}>
          {sec2ManualQs.map((q) => (
            <div key={q} style={{ display: "grid", gridTemplateColumns: "1fr 120px", gap: 10, marginBottom: 8 }}>
              <div>
                <div style={{ fontWeight: 600 }}>Q{q}</div>
                <textarea rows={2} value={String((selected.answers || {})[String(q)] || "")} readOnly />
              </div>
              <div>
                <label>Marks</label>
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={marks[String(q)] ?? ""}
                  onChange={(e) => setMarks((p) => ({ ...p, [String(q)]: e.target.value }))}
                />
              </div>
            </div>
          ))}
        </div>

        <div className="lau-modal-actions" style={{ marginTop: 12 }}>
          <button className="lau-cancel" onClick={() => setSelected(null)}>Back</button>
          <button className="lau-save" disabled={evaluating} onClick={handleEvaluate}>
            {evaluating ? "Saving..." : "Submit Evaluation"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="hr-main-container" style={{ maxWidth: 1200, margin: "0 auto" }}>
      <button className="btn-back-updates" onClick={onBack}><ArrowLeft size={16} /> Back to Updates</button>
      <h2 style={{ marginTop: 8 }}>Assessment Invite</h2>
      <p style={{ color: "#64748b" }}>Send 15-minute test links and evaluate submissions.</p>

      <form onSubmit={handleSend} style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(160px, 1fr))", gap: 10, background: "#fff", padding: 12, borderRadius: 10, border: "1px solid #e5e7eb" }}>
        <input
          placeholder="Candidate Name"
          value={form.full_name}
          onChange={(e) => setForm((p) => ({ ...p, full_name: e.target.value }))}
          required
        />
        <select
          value={form.department}
          onChange={(e) => setForm((p) => ({ ...p, department: e.target.value }))}
          required
        >
          <option value="">Select Department</option>
          {empTypeOptions.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <input
          type="email"
          placeholder="Candidate Email"
          value={form.email}
          onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
          required
        />
        <button className="btn-create-account" disabled={submitting}>{submitting ? "Sending..." : "Send Link"}</button>
      </form>

      {message && (
        <div
          className={messageType === "warning" ? "" : "lau-success"}
          style={
            messageType === "warning"
              ? {
                  marginTop: 10,
                  background: "#fffbeb",
                  color: "#92400e",
                  border: "1px solid #fcd34d",
                  borderRadius: 8,
                  padding: "10px 12px",
                }
              : { marginTop: 10 }
          }
        >
          {message}
        </div>
      )}
      {error && <div className="lau-error" style={{ marginTop: 10 }}>{error}</div>}

      <div style={{ marginTop: 16, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, overflow: "auto" }}>
        <table className="results-table" style={{ width: "100%" }}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Department</th>
              <th>Status</th>
              <th>Proctoring</th>
              <th>Submitted</th>
              <th>Photo</th>
              <th>Recording</th>
              <th>Total</th>
              <th>Avg %</th>
              <th>Action</th>
              <th>Delete</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.full_name}</td>
                <td>{r.candidate_email}</td>
                <td>{r.department}</td>
                <td>{renderStatusBadge(r.status)}</td>
                <td style={{ minWidth: 140 }}><IntegrityListBadges summary={r.integrity_summary} /></td>
                <td>{r.submitted_at ? new Date(r.submitted_at).toLocaleString() : "-"}</td>
                <td>{r.has_selfie ? "Yes" : "—"}</td>
                <td>{r.has_recording ? "Yes" : "—"}</td>
                <td>{r.total_score ?? "-"}</td>
                <td>{r.avg_score ?? "-"}</td>
                <td>
                  <button
                    type="button"
                    className="lau-edit-btn"
                    onClick={() => openSubmission(r.id)}
                    disabled={r.status !== "submitted" && r.status !== "disqualified"}
                  >
                    Review
                  </button>
                </td>
                <td>
                  <button
                    type="button"
                    className="lau-edit-btn"
                    onClick={() => handleDeleteInvite(r)}
                    title="Delete invite"
                    style={{ color: "#b91c1c", borderColor: "#fecaca", background: "#fff1f2" }}
                  >
                    <Trash2 size={14} /> Delete
                  </button>
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={12} style={{ textAlign: "center", padding: 16 }}>No invites found.</td></tr>
            )}
          </tbody>
        </table>
      </div>

    </div>
  );
}

