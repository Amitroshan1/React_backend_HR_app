import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { ACTION_LABELS, REMARK_POLICIES, validateRemark } from "./contracts";
import { isItamFlagEnabled } from "../../../utils/itamFlags";
import "./TransitionRemarkModal.css";

const TransitionRemarkContext = createContext(null);

const CONDITION_OPTIONS = ["A", "B", "C", "D", "Fail"];

export function TransitionRemarkProvider({ children }) {
  const [dialog, setDialog] = useState(null);
  const resolverRef = useRef(null);

  const close = useCallback((result) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setDialog(null);
    if (resolve) resolve(result);
  }, []);

  const requestRemark = useCallback((actionCode, meta = {}) => {
    const code = String(actionCode || "").trim().toUpperCase();
    const force = Boolean(meta.force);
    if (!force && !isItamFlagEnabled("itam_transitions_v1")) {
      return Promise.resolve({ skipped: true, remark: "", reasonCode: "", conditionGrade: "" });
    }
    return new Promise((resolve) => {
      resolverRef.current = resolve;
      setDialog({
        actionCode: code,
        title: meta.title || ACTION_LABELS[code] || code,
        assetLabel: meta.assetLabel || "",
        subtitle: meta.subtitle || "",
        defaultRemark: meta.defaultRemark || "",
        defaultReasonCode: meta.defaultReasonCode || "",
        defaultConditionGrade: meta.defaultConditionGrade || "",
      });
    });
  }, []);

  const value = useMemo(() => ({ requestRemark }), [requestRemark]);

  return (
    <TransitionRemarkContext.Provider value={value}>
      {children}
      {dialog ? (
        <TransitionRemarkModal
          {...dialog}
          onCancel={() => close(null)}
          onConfirm={(payload) => close({ skipped: false, ...payload })}
        />
      ) : null}
    </TransitionRemarkContext.Provider>
  );
}

export function useTransitionRemark() {
  const ctx = useContext(TransitionRemarkContext);
  if (!ctx) {
    return {
      requestRemark: async () => ({
        skipped: !isItamFlagEnabled("itam_transitions_v1"),
        remark: "",
        reasonCode: "",
        conditionGrade: "",
      }),
    };
  }
  return ctx;
}

function TransitionRemarkModal({
  actionCode,
  title,
  assetLabel,
  subtitle,
  defaultRemark,
  defaultReasonCode,
  defaultConditionGrade,
  onCancel,
  onConfirm,
}) {
  const policy = REMARK_POLICIES[actionCode] || { minLength: 10, reasonCodeRequired: false, conditionGradeRequired: false };
  const [remark, setRemark] = useState(defaultRemark || "");
  const [reasonCode, setReasonCode] = useState(defaultReasonCode || "");
  const [conditionGrade, setConditionGrade] = useState(
    defaultConditionGrade || (policy.conditionGradeRequired ? "B" : ""),
  );
  const [error, setError] = useState("");

  const submit = () => {
    const result = validateRemark(actionCode, remark, { reasonCode, conditionGrade });
    if (!result.ok) {
      setError(result.error || "Invalid remark");
      return;
    }
    onConfirm({
      remark: remark.trim(),
      reasonCode: reasonCode.trim(),
      conditionGrade: conditionGrade.trim(),
      notes: remark.trim(),
    });
  };

  return (
    <div className="itam-remark-overlay" role="dialog" aria-modal="true">
      <div className="itam-remark-modal">
        <header className="itam-remark-header">
          <h2>{title}</h2>
          {assetLabel ? <p className="itam-remark-asset">{assetLabel}</p> : null}
          {subtitle ? <p className="itam-remark-sub">{subtitle}</p> : null}
        </header>

        {policy.reasonCodeRequired ? (
          <label className="itam-remark-field">
            <span>Reason code</span>
            <input
              value={reasonCode}
              onChange={(e) => setReasonCode(e.target.value)}
              placeholder="e.g. EOL, LOST, EXPORT"
            />
          </label>
        ) : null}

        {policy.conditionGradeRequired ? (
          <label className="itam-remark-field">
            <span>Condition grade</span>
            <select value={conditionGrade} onChange={(e) => setConditionGrade(e.target.value)}>
              {CONDITION_OPTIONS.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <label className="itam-remark-field">
          <span>
            Remarks <em>(min {policy.minLength} characters)</em>
          </span>
          <textarea
            rows={4}
            value={remark}
            onChange={(e) => setRemark(e.target.value)}
            placeholder="Describe why this action is being taken…"
            autoFocus
          />
          <span className="itam-remark-count">
            {remark.trim().length}/{policy.minLength}
          </span>
        </label>

        {error ? <p className="itam-remark-error">{error}</p> : null}

        <footer className="itam-remark-actions">
          <button type="button" className="itam-remark-btn ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="itam-remark-btn primary" onClick={submit}>
            Confirm
          </button>
        </footer>
      </div>
    </div>
  );
}
