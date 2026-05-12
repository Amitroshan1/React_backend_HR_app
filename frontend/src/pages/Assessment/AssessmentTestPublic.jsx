import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import "./AssessmentTestPublic.css";

const API_BASE = "/api/HumanResource/assessment/public";

const parseApiUtcMs = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return NaN;
  // Backend currently sends naive ISO (UTC without timezone); force UTC parsing.
  const normalized =
    /[zZ]$|[+\-]\d{2}:\d{2}$/.test(raw) ? raw : `${raw}Z`;
  return new Date(normalized).getTime();
};

export default function AssessmentTestPublic() {
  const { token: tokenParam } = useParams();
  const [searchParams] = useSearchParams();
  const token = (tokenParam || searchParams.get("t") || "").trim();
  const navigate = useNavigate();
  const [invite, setInvite] = useState(null);
  const [questions, setQuestions] = useState(null);
  const [stage, setStage] = useState("loading"); // loading | instructions | permissions | test | submitted | blocked
  const [error, setError] = useState("");
  const [answers, setAnswers] = useState({});
  const [cameraGranted, setCameraGranted] = useState(false);
  const [micGranted, setMicGranted] = useState(false);
  const [selfieDataUrl, setSelfieDataUrl] = useState("");
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const autosaveRef = useRef(null);
  const [remainingSec, setRemainingSec] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const answersRef = useRef({});
  const tabLeaveStrikesRef = useRef(0);
  const tabLeaveEventsRef = useRef([]);
  const visibilityDebounceRef = useRef(null);
  const [tabSwitchWarnOpen, setTabSwitchWarnOpen] = useState(false);
  const [submitOutcome, setSubmitOutcome] = useState(null); // "ok" | "disqualified" | null

  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);

  useEffect(() => {
    submittingRef.current = submitting;
  }, [submitting]);

  const fetchStatus = async () => {
    const res = await fetch(`${API_BASE}/status?token=${encodeURIComponent(token)}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) throw new Error(data.message || "Invalid assessment link");
    return data.invite;
  };

  const fetchQuestions = async () => {
    const res = await fetch(`${API_BASE}/questions?token=${encodeURIComponent(token)}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) throw new Error(data.message || "Unable to load questions");
    return data;
  };

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const status = await fetchStatus();
        if (!mounted) return;
        setInvite(status);
        if (status.status === "submitted") {
          setSubmitOutcome("ok");
          setStage("submitted");
          return;
        }
        if (status.status === "disqualified") {
          setSubmitOutcome("disqualified");
          setStage("submitted");
          return;
        }
        if (status.status === "expired") {
          setStage("blocked");
          setError("This assessment link has expired.");
          return;
        }
        const q = await fetchQuestions();
        if (!mounted) return;
        setInvite(q.invite);
        setQuestions(q.questions);
        setStage("instructions");
      } catch (e) {
        if (!mounted) return;
        setError(e.message || "Unable to continue");
        setStage("blocked");
      }
    })();
    return () => { mounted = false; };
  }, [token]);

  const handleSubmit = async (opts = {}) => {
    const disqualified = opts.disqualified === true;
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    if (autosaveRef.current) clearInterval(autosaveRef.current);

    const base = { ...answersRef.current };
    const events = tabLeaveEventsRef.current;
    if (events.length > 0 || disqualified) {
      base.__integrity = {
        tab_hide_timestamps_utc: [...events],
        tab_hide_count: events.length,
        disqualified: !!disqualified,
      };
    }

    const res = await fetch(`${API_BASE}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, answers: base, disqualified }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      setError(data.message || "Submit failed");
      setSubmitting(false);
      submittingRef.current = false;
      return;
    }
    if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
    setInvite(data.invite);
    setSubmitOutcome(data.invite?.disqualified ? "disqualified" : "ok");
    setStage("submitted");
    setSubmitting(false);
    submittingRef.current = false;
  };

  useEffect(() => {
    if (stage !== "test" || !invite?.started_at) return undefined;
    const dur = Number(invite.duration_minutes || 180);
    const startedMs = parseApiUtcMs(invite.started_at);
    if (!Number.isFinite(startedMs)) return undefined;
    const tick = () => {
      const rem = Math.max(0, Math.floor((startedMs + dur * 60 * 1000 - Date.now()) / 1000));
      setRemainingSec(rem);
      if (rem <= 0) {
        handleSubmit({});
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, invite?.started_at, invite?.duration_minutes]);

  useEffect(() => {
    if (stage !== "test") return undefined;
    const onVis = () => {
      if (document.visibilityState !== "hidden") return;
      if (submittingRef.current) return;
      if (visibilityDebounceRef.current) clearTimeout(visibilityDebounceRef.current);
      visibilityDebounceRef.current = setTimeout(() => {
        tabLeaveEventsRef.current.push(new Date().toISOString());
        tabLeaveStrikesRef.current += 1;
        const strike = tabLeaveStrikesRef.current;
        if (strike >= 2) {
          setTabSwitchWarnOpen(false);
          handleSubmit({ disqualified: true });
        } else {
          setTabSwitchWarnOpen(true);
        }
      }, 200);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      if (visibilityDebounceRef.current) clearTimeout(visibilityDebounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  useEffect(() => {
    if (stage !== "test") return undefined;
    const onPop = () => {
      alert("Test already started. Back navigation is disabled.");
      navigate(`/assessment/${token}`, { replace: true });
    };
    window.history.pushState(null, "", window.location.href);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [stage, navigate, token]);

  const startDevices = async () => {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      streamRef.current = stream;
      setCameraGranted(true);
      setMicGranted(true);
      if (videoRef.current) videoRef.current.srcObject = stream;
    } catch (e) {
      setError("Camera and microphone permissions are required to continue.");
    }
  };

  const captureSelfie = () => {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    setSelfieDataUrl(dataUrl);
  };

  const startAssessment = async () => {
    setError("");
    if (!selfieDataUrl) {
      alert("Please capture your photo before proceeding.");
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          selfie_data_url: selfieDataUrl,
          camera_granted: cameraGranted,
          mic_granted: micGranted,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        setError(data.message || "Unable to start assessment");
        return;
      }
      setInvite(data.invite);
      setStage("test");
      tabLeaveStrikesRef.current = 0;
      tabLeaveEventsRef.current = [];
      autosaveRef.current = setInterval(async () => {
        await fetch(`${API_BASE}/save-answer`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, answers: answersRef.current }),
        });
      }, 12000);
    } catch (e) {
      setError("Unable to start assessment right now. Please try again.");
    }
  };

  useEffect(() => () => {
    if (autosaveRef.current) clearInterval(autosaveRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
    }
  }, []);

  const timerText = useMemo(() => {
    const h = Math.floor(remainingSec / 3600);
    const m = Math.floor((remainingSec % 3600) / 60);
    const s = remainingSec % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }, [remainingSec]);

  if (stage === "loading") return <div className="assessment-shell"><div className="assessment-card"><p>Loading assessment...</p></div></div>;
  if (stage === "blocked") return <div className="assessment-shell"><div className="assessment-card"><h2>Unable to continue</h2><p>{error || "Access blocked."}</p></div></div>;
  if (stage === "submitted") {
    const disq = submitOutcome === "disqualified";
    return (
      <div className="assessment-shell">
        <div className="assessment-card">
          <h2>{disq ? "Attempt disqualified" : "Test submitted successfully"}</h2>
          <p>
            {disq
              ? "This attempt was closed because the assessment window lost focus more than once (for example, switching browser tabs). HR has been notified."
              : `Thank you. Attempt ${invite?.attempt_no || 1} completed.`}
          </p>
        </div>
      </div>
    );
  }

  if (stage === "instructions") {
    return (
      <div className="assessment-shell">
        <div className="assessment-card">
        <h2>Assessment Instructions</h2>
        <ul className="assessment-list">
          <li>Single attempt only. Do not refresh or close the browser.</li>
          <li>Stay on this tab for the entire test. The first time you leave this tab you will see a warning; leaving again will disqualify this attempt and auto-submit your answers.</li>
          <li>No cheating, no external help.</li>
          <li>Total duration: {invite?.duration_minutes || 180} minutes.</li>
          <li>Sections: Q1-25 MCQ, Q26-33 MCQ, Q34-62 descriptive, Q63-87 MCQ.</li>
          <li>Your camera photo capture is mandatory before starting.</li>
          <li>Camera and microphone permissions are required.</li>
          <li>Do not use mobile phones, notes, external websites, or AI tools.</li>
          <li>Any malpractice may lead to disqualification.</li>
          <li>Answers are auto-saved periodically, but submit before timer ends.</li>
          <li>Once submitted, test cannot be reopened.</li>
        </ul>
        <button className="assessment-btn assessment-btn-primary" onClick={() => setStage("permissions")}>Proceed</button>
        </div>
      </div>
    );
  }

  if (stage === "permissions") {
    return (
      <div className="assessment-shell">
        <div className="assessment-card">
        <h2>Permissions & Photo Capture</h2>
        <button className="assessment-btn assessment-btn-primary" onClick={startDevices}>Enable Camera + Microphone</button>
        <div className="assessment-video-wrap">
          <video ref={videoRef} autoPlay muted className="assessment-video" />
        </div>
        <div className="assessment-actions-row">
          <button className="assessment-btn" onClick={captureSelfie} disabled={!cameraGranted}>Capture Photo</button>
          {selfieDataUrl ? <span className="assessment-ok">Photo captured</span> : null}
        </div>
        <div className="assessment-actions-row">
          <button className="assessment-btn assessment-btn-primary" onClick={startAssessment} disabled={!cameraGranted || !micGranted || !selfieDataUrl}>Start Assessment</button>
        </div>
        {error ? <div className="assessment-error">{error}</div> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="assessment-shell">
      {tabSwitchWarnOpen ? (
        <div className="assessment-modal-backdrop" role="presentation">
          <div className="assessment-modal" role="dialog" aria-modal="true" aria-labelledby="assessment-tab-warn-title">
            <h3 id="assessment-tab-warn-title">Assessment focus warning</h3>
            <p>
              You left this assessment tab or minimized the window. If you do that again, this attempt will be
              <strong> disqualified</strong> and your answers will be submitted automatically for HR review.
            </p>
            <button type="button" className="assessment-btn assessment-btn-primary" onClick={() => setTabSwitchWarnOpen(false)}>
              I understand — continue
            </button>
          </div>
        </div>
      ) : null}
      <div className="assessment-main">
      <div className="assessment-timer">
        <strong>Time Left: {timerText}</strong>
      </div>
      <h3 className="assessment-section-title">Section 1 (Q1-25) - MCQ</h3>
      {(questions?.section_1 || []).map((q) => (
        <div key={q.number} className="assessment-q-card">
          <div className="assessment-question">{q.number}. {q.question}</div>
          {(q.options || []).map((opt, idx) => (
            <label key={idx} className="assessment-option">
              <input
                type="radio"
                name={`q_${q.number}`}
                value={idx + 1}
                checked={String(answers[String(q.number)] || "") === String(idx + 1)}
                onChange={() => setAnswers((p) => ({ ...p, [String(q.number)]: idx + 1 }))}
              /> {opt}
            </label>
          ))}
        </div>
      ))}

      <h3 className="assessment-section-title">Section 2 (Q26-62) - Mixed</h3>
      {(questions?.section_2 || []).map((q) => (
        <div key={q.number} className="assessment-q-card">
          <div className="assessment-question">{q.number}. {q.question}</div>
          {q.type === "mcq" ? (
            (q.options || []).map((opt, idx) => (
              <label key={idx} className="assessment-option">
                <input
                  type="radio"
                  name={`q_${q.number}`}
                  value={idx + 1}
                  checked={String(answers[String(q.number)] || "") === String(idx + 1)}
                  onChange={() => setAnswers((p) => ({ ...p, [String(q.number)]: idx + 1 }))}
                /> {opt}
              </label>
            ))
          ) : (
            <textarea
              rows={3}
              className="assessment-textarea"
              value={String(answers[String(q.number)] || "")}
              onChange={(e) => setAnswers((p) => ({ ...p, [String(q.number)]: e.target.value }))}
            />
          )}
        </div>
      ))}

      <h3 className="assessment-section-title">Section 3 (Q63-87) - MCQ</h3>
      {(questions?.section_3 || []).map((q) => (
        <div key={q.number} className="assessment-q-card">
          <div className="assessment-question">{q.number}. {q.question}</div>
          {(q.options || []).map((opt, idx) => (
            <label key={idx} className="assessment-option">
              <input
                type="radio"
                name={`q_${q.number}`}
                value={idx + 1}
                checked={String(answers[String(q.number)] || "") === String(idx + 1)}
                onChange={() => setAnswers((p) => ({ ...p, [String(q.number)]: idx + 1 }))}
              /> {opt}
            </label>
          ))}
        </div>
      ))}

      {error ? <div className="assessment-error">{error}</div> : null}
      <button className="assessment-btn assessment-btn-primary assessment-submit" onClick={() => handleSubmit({})} disabled={submitting}>
        {submitting ? "Submitting..." : "Submit Test"}
      </button>
      </div>
    </div>
  );
}
