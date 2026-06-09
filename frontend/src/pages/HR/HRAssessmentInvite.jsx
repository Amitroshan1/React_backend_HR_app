import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Mail, Play, ShieldAlert, Trash2 } from "lucide-react";
import {
  formatAssessmentQuestionHeading,
  getAssessmentFigureSrc,
} from "../../utils/assessmentFigures";
import SessionRecordingPlayer from "./SessionRecordingPlayer";
import { getEmailFieldError, isValidEmail } from "../../utils/isValidEmail";
import "./HRAssessmentInvite.css";
import "./LeaveApplicationUpdation.css";

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

function AssessmentReviewFigure({ q }) {
  const src = getAssessmentFigureSrc(q?.number, q?.image_url);
  if (!src) return null;
  return (
    <div
      style={{
        margin: "8px 0 10px",
        padding: 10,
        background: "#f8fafc",
        border: "1px solid #e2e8f0",
        borderRadius: 8,
        overflowX: "auto",
      }}
    >
      <img
        src={src}
        alt={`Figure for question ${q.number}`}
        style={{ display: "block", maxWidth: "100%", height: "auto", margin: "0 auto" }}
      />
    </div>
  );
}

function IntegrityReviewPanel({ integrity }) {
  if (!hasIntegrityContent(integrity)) return null;

  const tabN = Number(integrity.tab_hide_count) || 0;
  const blurN = Number(integrity.window_blur_count) || 0;
  const pasteN = Number(integrity.paste_attempt_count) || 0;
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
    </div>
  );
}

export function HRAssessmentInvite({ onBack, empTypeOptions = [] }) {
  const [form, setForm] = useState({ full_name: "", email: "", department: empTypeOptions[0] || "" });
  const [emailTouched, setEmailTouched] = useState(false);
  const [emailSubmitted, setEmailSubmitted] = useState(false);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState("success");
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);
  const [marks, setMarks] = useState({});
  const [evaluating, setEvaluating] = useState(false);
  const [emailingHrReport, setEmailingHrReport] = useState(false);
  const [recordingVideoUrl, setRecordingVideoUrl] = useState(null);
  const [recordingLoading, setRecordingLoading] = useState(false);
  const [recordingError, setRecordingError] = useState("");
  const [recordingModalOpen, setRecordingModalOpen] = useState(false);
  const recordingVideoRef = useRef(null);
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

  // Auto-refresh selected submission while media upload metadata is still catching up.
  useEffect(() => {
    if (!selected?.id) return undefined;
    const status = String(selected.status || "").toLowerCase();
    const shouldPoll =
      ["submitted", "disqualified", "evaluated"].includes(status) &&
      (!selected.has_recording || !selected.has_selfie);
    if (!shouldPoll) return undefined;

    let cancelled = false;
    let inFlight = false;

    const refreshSelected = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      try {
        const res = await fetch(`${HR_API_BASE}/assessment/invites/${selected.id}`, {
          headers: getAuthHeaders(),
        });
        const data = await res.json().catch(() => ({}));
        if (!cancelled && res.ok && data.success) {
          const invite = data.invite || null;
          setSelected(invite);
          setMarks(invite?.manual_marks || {});
        }
      } catch {
        /* silent background refresh */
      } finally {
        inFlight = false;
      }
    };

    const first = window.setTimeout(refreshSelected, 2500);
    const interval = window.setInterval(refreshSelected, 8000);
    return () => {
      cancelled = true;
      window.clearTimeout(first);
      window.clearInterval(interval);
    };
  }, [selected?.id, selected?.status, selected?.has_recording, selected?.has_selfie]);

  useEffect(() => {
    setRecordingModalOpen(false);
    setRecordingVideoUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setRecordingLoading(false);
    setRecordingError("");
  }, [selected?.id]);

  const closeRecordingModal = useCallback(() => {
    try {
      recordingVideoRef.current?.pause?.();
    } catch {
      /* ignore */
    }
    setRecordingModalOpen(false);
  }, []);

  useEffect(() => {
    if (!recordingModalOpen) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") closeRecordingModal();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [recordingModalOpen, closeRecordingModal]);

  const openRecordingPlayer = useCallback(async () => {
    if (!selected?.id || !selected.has_recording) return;
    if (recordingLoading) return;
    setRecordingError("");
    if (recordingVideoUrl) {
      setRecordingModalOpen(true);
      return;
    }
    setRecordingLoading(true);
    try {
      const res = await fetch(`${HR_API_BASE}/assessment/invites/${selected.id}/recording`, {
        headers: getAuthHeaders(),
      });
      if (!res.ok) {
        let msg = `Unable to load recording (${res.status})`;
        try {
          const j = await res.json();
          if (j.message) msg = j.message;
        } catch {
          /* use default */
        }
        throw new Error(msg);
      }
      const blob = await res.blob();
      if (!blob || blob.size === 0) throw new Error("Recording file is empty.");
      const url = URL.createObjectURL(blob);
      setRecordingVideoUrl(url);
      setRecordingModalOpen(true);
    } catch (e) {
      setRecordingError(e.message || "Failed to load recording");
    } finally {
      setRecordingLoading(false);
    }
  }, [selected?.id, selected?.has_recording, recordingVideoUrl, recordingLoading]);

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

  const emailFieldError = getEmailFieldError(form.email, {
    touched: emailTouched,
    submitted: emailSubmitted,
  });
  const emailReady = isValidEmail(form.email);
  const formReady =
    form.full_name.trim() &&
    form.department.trim() &&
    emailReady;

  const handleSend = async (e) => {
    e.preventDefault();
    setEmailSubmitted(true);
    const fieldErr = getEmailFieldError(form.email, { touched: true, submitted: true });
    if (fieldErr) {
      setError(fieldErr);
      return;
    }
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
      setMessage(data.message || "Assessment invite sent successfully.");
      setMessageType("success");
      setForm((p) => ({ ...p, full_name: "", email: "" }));
      setEmailTouched(false);
      setEmailSubmitted(false);
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

  const canEmailHrReport =
    selected &&
    ["submitted", "disqualified", "evaluated"].includes(String(selected.status || "").toLowerCase());

  const handleEmailHrReport = async () => {
    if (!selected?.id || !canEmailHrReport) return;
    const ok = window.confirm(
      "Send an email to HR with this candidate’s Arithmetic & English proficiency table and Section 2 (Q26–62) questions and answers?"
    );
    if (!ok) return;
    setEmailingHrReport(true);
    setError("");
    setMessage("");
    setMessageType("success");
    try {
      const res = await fetch(`${HR_API_BASE}/assessment/invites/${selected.id}/email-hr-report`, {
        method: "POST",
        headers: getAuthHeaders(),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.message || "Failed to send report email");
      const extra = String(data.email_provider_message || "").trim();
      setMessage(extra ? `${data.message || "Report emailed to HR."} (${extra})` : data.message || "Report emailed to HR.");
    } catch (e) {
      setError(e.message || "Failed to send report email");
    } finally {
      setEmailingHrReport(false);
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

  const questionsByNumber = useMemo(() => {
    const map = new Map();
    const sections = selected?.questions || {};
    for (const key of ["section_1", "section_2", "section_3"]) {
      for (const q of sections[key] || []) {
        map.set(Number(q.number), q);
      }
    }
    return map;
  }, [selected?.questions]);

  const manualReviewQuestions = useMemo(() => {
    const fromPayload = (selected?.questions?.section_2 || []).filter(
      (q) => Number(q.number) >= 34 && Number(q.number) <= 62
    );
    if (fromPayload.length > 0) {
      return [...fromPayload].sort((a, b) => Number(a.number) - Number(b.number));
    }
    return sec2ManualQs.map((n) => questionsByNumber.get(n) || { number: n, question: "", type: "subjective" });
  }, [selected?.questions, sec2ManualQs, questionsByNumber]);

  const getObjectiveQuestionsByNumbers = (questionNumbers) => {
    const wanted = questionNumbers.map((n) => Number(n));
    return wanted
      .map((n) => questionsByNumber.get(n))
      .filter(Boolean);
  };

  const renderObjectiveSection = (questionNumbers, title) => (
    <div style={{ marginTop: 14 }}>
      <h4 style={{ margin: "0 0 8px" }}>{title}</h4>
      <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 8, background: "#fafafa" }}>
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
                <div style={{ fontWeight: 700, marginBottom: 4, whiteSpace: "pre-line", lineHeight: 1.5 }}>
                  {formatAssessmentQuestionHeading(qNo, q.question)}
                </div>
                <AssessmentReviewFigure q={q} />
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
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 10,
            marginBottom: 12,
          }}
        >
          <button type="button" className="btn-back-updates" onClick={() => setSelected(null)}>
            <ArrowLeft size={16} /> Back to Invite List
          </button>
          <button
            type="button"
            className="lau-edit-btn"
            disabled={emailingHrReport || !canEmailHrReport}
            onClick={handleEmailHrReport}
            title={
              canEmailHrReport
                ? "Email HR the proficiency summary and Section 2 Q&A for this attempt"
                : "Available after the candidate submits or the attempt is evaluated"
            }
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <Mail size={16} aria-hidden />
            {emailingHrReport ? "Sending…" : "Email report to HR"}
          </button>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 20,
            flexWrap: "wrap",
            marginTop: 0,
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
            <button
              type="button"
              className="lau-edit-btn"
              onClick={openRecordingPlayer}
              disabled={recordingLoading}
              style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              <Play size={16} />
              {recordingLoading ? "Loading…" : "Play session recording"}
            </button>
            {recordingError ? <p style={{ fontSize: 13, color: "#b91c1c", margin: "10px 0 0" }}>{recordingError}</p> : null}
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
          {manualReviewQuestions.map((q) => {
            const qNo = Number(q.number);
            const answerRaw = (selected.answers || {})[String(qNo)];
            const answerText = answerRaw == null ? "" : String(answerRaw);
            const hasAnswer = answerText.trim().length > 0;
            const rowMinRows = Math.min(12, Math.max(3, Math.ceil(answerText.length / 72) || 3));
            return (
              <div
                key={qNo}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 120px",
                  gap: 12,
                  marginBottom: 14,
                  paddingBottom: 14,
                  borderBottom: "1px solid #f1f5f9",
                }}
              >
                <div>
                  <div style={{ fontWeight: 700, marginBottom: 6, color: "#0f172a", lineHeight: 1.5, whiteSpace: "pre-line" }}>
                    {formatAssessmentQuestionHeading(qNo, q.question || "(Question text unavailable)")}
                  </div>
                  <AssessmentReviewFigure q={q} />
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#64748b", marginBottom: 4 }}>Candidate answer</div>
                  {hasAnswer ? (
                    <textarea
                      rows={rowMinRows}
                      value={answerText}
                      readOnly
                      style={{
                        width: "100%",
                        border: "1px solid #cbd5e1",
                        borderRadius: 8,
                        padding: 10,
                        fontSize: 14,
                        lineHeight: 1.5,
                        resize: "vertical",
                        background: "#f8fafc",
                        color: "#0f172a",
                      }}
                    />
                  ) : (
                    <p style={{ margin: 0, fontSize: 14, color: "#94a3b8", fontStyle: "italic" }}>
                      No answer submitted.
                    </p>
                  )}
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: "#475569" }}>Marks</label>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    value={marks[String(qNo)] ?? ""}
                    onChange={(e) => setMarks((p) => ({ ...p, [String(qNo)]: e.target.value }))}
                    style={{ width: "100%", marginTop: 4 }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        <div className="lau-modal-actions" style={{ marginTop: 12, justifyContent: "flex-end" }}>
          <button type="button" className="lau-save" disabled={evaluating} onClick={handleEvaluate}>
            {evaluating ? "Saving..." : "Submit Evaluation"}
          </button>
        </div>

        {recordingModalOpen && recordingVideoUrl ? (
          <div
            role="presentation"
            onClick={closeRecordingModal}
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 2000,
              background: "rgba(15, 23, 42, 0.55)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 16,
            }}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Session recording"
              onClick={(e) => e.stopPropagation()}
              style={{
                width: "100%",
                maxWidth: 960,
                background: "#fff",
                borderRadius: 12,
                padding: 16,
                boxShadow: "0 25px 50px -12px rgba(15, 23, 42, 0.35)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <strong style={{ fontSize: 16 }}>Session recording</strong>
                <button type="button" className="lau-cancel" onClick={closeRecordingModal}>
                  Close
                </button>
              </div>
              <SessionRecordingPlayer
                src={recordingVideoUrl}
                videoRef={recordingVideoRef}
                autoPlay
              />
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="hr-main-container assessment-invite-page">
      <button type="button" className="btn-back-updates" onClick={onBack}><ArrowLeft size={16} /> Back to Updates</button>
      <header className="assessment-invite-header">
        <h2>Assessment Invite</h2>
        <p>Send 15-minute test links and evaluate submissions.</p>
      </header>

      <form className="assessment-invite-form" onSubmit={handleSend}>
        <div className="assessment-invite-field">
          <label htmlFor="assessment-candidate-name">Candidate name</label>
          <input
            id="assessment-candidate-name"
            className="assessment-invite-input"
            placeholder="e.g. Priya Sharma"
            value={form.full_name}
            onChange={(e) => setForm((p) => ({ ...p, full_name: e.target.value }))}
            required
          />
        </div>
        <div className="assessment-invite-field">
          <label htmlFor="assessment-department">Department</label>
          <select
            id="assessment-department"
            className="assessment-invite-select"
            value={form.department}
            onChange={(e) => setForm((p) => ({ ...p, department: e.target.value }))}
            required
          >
            <option value="">Select department</option>
            {empTypeOptions.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <div className="assessment-invite-field">
          <label htmlFor="assessment-candidate-email">Candidate email</label>
          <input
            id="assessment-candidate-email"
            type="email"
            className={`assessment-invite-input${emailFieldError ? " assessment-invite-input--invalid" : ""}`}
            placeholder="name@example.com"
            value={form.email}
            onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
            onBlur={() => setEmailTouched(true)}
            aria-invalid={emailFieldError ? "true" : undefined}
            aria-describedby={emailFieldError ? "assessment-candidate-email-error" : undefined}
            required
          />
          {emailFieldError ? (
            <span id="assessment-candidate-email-error" className="assessment-invite-field-error" role="alert">
              {emailFieldError}
            </span>
          ) : null}
        </div>
        <button type="submit" className="assessment-invite-submit" disabled={submitting || !formReady}>
          {submitting ? "Sending…" : "Send link"}
        </button>
      </form>

      {message ? (
        <div
          className={`assessment-invite-alert ${
            messageType === "warning" ? "assessment-invite-alert--warning" : "assessment-invite-alert--success"
          }`}
        >
          {message}
        </div>
      ) : null}
      {error ? <div className="assessment-invite-alert assessment-invite-alert--error">{error}</div> : null}

      <div className="assessment-invite-table-wrap">
        <table className="assessment-invite-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Department</th>
              <th>Status</th>
              <th>Proctoring</th>
              <th>Submitted</th>
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
                    className="lau-edit-btn assessment-invite-delete-btn"
                    onClick={() => handleDeleteInvite(r)}
                    title="Delete invite"
                  >
                    <Trash2 size={14} /> Delete
                  </button>
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={10} className="assessment-invite-table-empty">No invites found.</td></tr>
            )}
          </tbody>
        </table>
      </div>

    </div>
  );
}

