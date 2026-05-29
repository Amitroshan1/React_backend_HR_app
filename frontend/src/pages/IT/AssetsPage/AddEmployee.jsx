

import React, { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import {
  getEmployees,
  saveEmployees,
  getAssetUnitsFromStorage,
  saveAssetUnitsToStorage,
  getInventoryFromStorage,
  saveInventoryToStorage,
  getSoftwareInventory,
  saveSoftwareInventory,
  assignSoftwareToEmployeeAPI,
  assignInventoryQuantityAPI,
  assignUnitToEmployeeAPI,
  compressImage,
  getITApiErrorMessage,
  lookupEmployeeByEmpIdOrEmailAPI,
  syncITDataFromAPI,
  SEED_EMPLOYEES,
} from "../Data";
import "./AddEmployee.css";

// ─── Pure utilities ───────────────────────────────────────────────────────────

const generateAssetId = () =>
  "ASSET-" +
  Date.now().toString(36).toUpperCase() +
  "-" +
  Math.random().toString(36).slice(2, 6).toUpperCase();

// ─── Constants ────────────────────────────────────────────────────────────────

const ASSIGN_CATS   = ["Hardware", "Software", "Accessories", "Consumables"];
const HW_TYPES      = ["Laptop", "Mobile", "Desktop", "Tablet", "Other"];
const STEPS         = ["Profile", "Assign Assets", "Review"];
const TAB_ICONS     = { Hardware: "🖥️", Software: "💿", Accessories: "🖱️", Consumables: "📦" };
const HW_TYPE_ICONS = { Laptop: "💻", Mobile: "📱", Desktop: "🖥️", Tablet: "📲", Other: "🔧" };

const EMPTY_PROFILE = {
  employeeId: "", name: "", type: "", circle: "", email: "", photoUrl: "", photoFile: null,
};

const EMAIL_LOOKUP_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMP_ID_LOOKUP_RE = /^EMP[A-Z0-9]+$/i;
const LOOKUP_DEBOUNCE_MS = 500;

function isLookupQueryReady(raw) {
  const q = String(raw || "").trim();
  if (!q) return false;
  if (EMAIL_LOOKUP_RE.test(q)) return true;
  if (EMP_ID_LOOKUP_RE.test(q)) return true;
  return false;
}

// ─── Self-healing employee getter ─────────────────────────────────────────────

function getEmployeesSafe() {
  try {
    const existing = getEmployees();
    if (Array.isArray(existing) && existing.length > 0) return existing;
    if (Array.isArray(SEED_EMPLOYEES) && SEED_EMPLOYEES.length > 0) {
      saveEmployees(SEED_EMPLOYEES);
      console.warn("[AddEmployee] employees was empty — restored seed employees.");
      return SEED_EMPLOYEES;
    }
  } catch (_) {}
  return [];
}

// ─── Initials avatar ──────────────────────────────────────────────────────────

const makeInitialsAvatar = (name = "") => {
  const parts    = name.trim().split(/\s+/).filter(Boolean);
  const initials =
    parts.length >= 2
      ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
      : (parts[0]?.[0] || "?").toUpperCase();
  const canvas     = document.createElement("canvas");
  canvas.width     = canvas.height = 128;
  const ctx        = canvas.getContext("2d");
  ctx.fillStyle    = "#4CAF50";
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle    = "#fff";
  ctx.font         = "bold 52px Arial, sans-serif";
  ctx.textAlign    = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(initials, 64, 64);
  return canvas.toDataURL("image/png");
};

// ─── SuccessPopup ─────────────────────────────────────────────────────────────

const SuccessPopup = ({ employeeName, totalAssets, onClose }) => (
  <div className="ane-success-overlay">
    <div className="ane-success-box">
      <div className="ane-success-icon-wrap">✅</div>
      <h2 className="ane-success-title">Employee Saved!</h2>
      <p className="ane-success-sub">
        <strong>{employeeName}</strong> has been added successfully.
      </p>
      <p className="ane-success-count">
        {totalAssets} asset{totalAssets !== 1 ? "s" : ""} assigned
      </p>
      <button className="ane-success-btn" onClick={onClose}>
        Go to Assets Dashboard →
      </button>
    </div>
  </div>
);

// ─── LookupGate ──────────────────────────────────────────────────────────────

const LookupGate = ({ onFound }) => {
  const navigate = useNavigate();

  const [query,         setQuery]         = useState("");
  const [loading,       setLoading]       = useState(false);
  const [notFound,      setNotFound]      = useState(false);
  const [alreadyExists, setAlreadyExists] = useState(null);
  const lastFetchedRef = useRef("");
  const searchInFlightRef = useRef(false);

  const clearMessages = useCallback(() => {
    setNotFound(false);
    setAlreadyExists(null);
  }, []);

  // Computed once per mount — unactivated employees list doesn't change
  // during LookupGate's lifetime; moving inside useMemo prevents calling
  // getEmployeesSafe() on every single keystroke.
  const hints = useMemo(() =>
    getEmployeesSafe()
      .filter((e) => !e.activated)
      .slice(0, 3)
      .map((e) => ({ label: `${e.id} — ${e.name}`, value: e.id })),
  [], // stable — employees don't change while LookupGate is mounted
  );

  const performSearch = useCallback(
    async (rawQuery) => {
      const trimmed = String(rawQuery || "").trim();
      const q = trimmed.toLowerCase();
      if (!q || !isLookupQueryReady(trimmed) || searchInFlightRef.current) return;

      searchInFlightRef.current = true;
      setLoading(true);

      let match = null;
      try {
        const apiRows = await lookupEmployeeByEmpIdOrEmailAPI(trimmed);
        match =
          apiRows.find((emp) => {
            const id = (emp.id || emp.empId || "").toLowerCase();
            const email = (emp.email || "").toLowerCase();
            return id === q || email === q;
          }) || null;
      } catch (err) {
        console.warn("[AddEmployee] lookup API failed; falling back to local store", err);
      } finally {
        searchInFlightRef.current = false;
        setLoading(false);
      }

      if (!match) {
        const employees = getEmployeesSafe();
        match =
          employees.find((emp) => {
            const id = (emp.id || emp.empId || "").toLowerCase();
            const email = (emp.email || "").toLowerCase();
            return id === q || email === q;
          }) || null;
      }

      if (!match) {
        setNotFound(true);
        setAlreadyExists(null);
        return;
      }

      if (match.activated && (match.assignedAssets || []).length > 0) {
        setAlreadyExists(match);
        setNotFound(false);
        return;
      }

      clearMessages();
      onFound(match);
    },
    [onFound, clearMessages],
  );

  useEffect(() => {
    const trimmed = query.trim();
    if (!isLookupQueryReady(trimmed)) {
      return undefined;
    }
    const timer = setTimeout(() => {
      if (lastFetchedRef.current === trimmed) return;
      lastFetchedRef.current = trimmed;
      performSearch(trimmed);
    }, LOOKUP_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, performSearch]);

  const handleQueryChange = useCallback(
    (e) => {
      setQuery(e.target.value);
      clearMessages();
      lastFetchedRef.current = "";
    },
    [clearMessages],
  );

  const applyHint = useCallback(
    (value) => {
      setQuery(value);
      clearMessages();
      lastFetchedRef.current = "";
    },
    [clearMessages],
  );

  const hasError = notFound || !!alreadyExists;
  const queryReady = isLookupQueryReady(query);

  return (
    <div className="ane-lookup-wrap">
      <div className="ane-lookup-icon">🔍</div>
      <h2 className="ane-lookup-title">Find Employee Profile</h2>
      <p className="ane-lookup-sub">
        Enter a complete <strong>Employee ID</strong> (e.g. EMP004) or <strong>email</strong> — your profile loads automatically.
      </p>

      <div className="ane-lookup-field">
        <div
          className={`ane-lookup-input-wrap${hasError ? " ane-lookup-input-wrap--error" : ""}${loading ? " ane-lookup-input-wrap--loading" : ""}`}
        >
          <span className="ane-lookup-input-icon" aria-hidden>
            {loading ? "⏳" : "🔍"}
          </span>
          <input
            className="ane-lookup-input"
            type="text"
            placeholder="e.g. EMP004 or neha.patel@company.com"
            value={query}
            onChange={handleQueryChange}
            autoFocus
            autoComplete="off"
            spellCheck={false}
            aria-busy={loading}
            aria-invalid={hasError}
          />
          {loading && (
            <span className="ane-lookup-spinner" aria-label="Searching" />
          )}
        </div>
        <p className="ane-lookup-helper">
          {loading
            ? "Fetching employee profile…"
            : queryReady
              ? "Searching automatically"
              : "Type a full employee ID or email address"}
        </p>
      </div>

      {/* Quick-pick hints */}
      {hints.length > 0 && (
        <div className="ane-lookup-hints">
          <span className="ane-lookup-hint-label">Quick pick:</span>
          {hints.map((h) => (
            <button
              key={h.value}
              type="button"
              className="ane-lookup-hint-btn"
              onClick={() => applyHint(h.value)}
            >
              {h.label}
            </button>
          ))}
        </div>
      )}

      {/* Not-found message */}
      {notFound && (
        <div className="ane-lookup-not-found">
          <span>⚠️</span> No employee found for <strong>"{query}"</strong>. Please check and try again.
        </div>
      )}

      {/* Already-active warning */}
      {alreadyExists && (
        <div className="ane-lookup-already-exists">
          <div className="ane-lookup-already-exists-icon">⚠️</div>
          <div className="ane-lookup-already-exists-content">
            <strong>Employee Already Active</strong>
            <p>
              <span className="ane-lookup-already-exists-id">{alreadyExists.id}</span>{" "}
              — <em>{alreadyExists.name}</em> already has{" "}
              {(alreadyExists.assignedAssets || []).length} asset(s) assigned.
              You can assign more assets or go to the <strong>Assets Dashboard</strong> to manage them.
            </p>
            <div className="ane-lookup-already-exists-actions">
              <button
                className="ane-lookup-btn-assign-more"
                onClick={() => { setAlreadyExists(null); onFound(alreadyExists); }}
              >
                ＋ Assign More Assets
              </button>
              <button
                className="ane-lookup-btn-dashboard"
                onClick={() => navigate(-1)}
              >
                Go to Assets Dashboard
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── ProfileSummaryBanner ─────────────────────────────────────────────────────

const ProfileSummaryBanner = ({ profile }) => {
  // useMemo so the canvas is not recreated on every parent re-render
  const fallbackAvatar = useMemo(
    () => makeInitialsAvatar(profile.name),
    [profile.name],
  );

  const [imgSrc, setImgSrc] = React.useState(
    profile.photoFile || profile.photoUrl || fallbackAvatar,
  );

  React.useEffect(() => {
    setImgSrc(profile.photoFile || profile.photoUrl || fallbackAvatar);
  }, [profile.photoFile, profile.photoUrl, fallbackAvatar]);

  const bannerFields = [
    ["Emp ID",        profile.employeeId, "id"],
    ["Emp Name",      profile.name],
    ["Employee Type", profile.type   || "—"],
    ["Circle",        profile.circle || "—", "circle"],
  ];

  return (
    <div className="ane-profile-banner">
      <div className="ane-profile-banner-top">
        <div className="ane-profile-banner-left">
          {bannerFields.map(([label, value, mod]) => (
            <div
              key={label}
              className={`ane-profile-banner-field-box${mod === "circle" ? " ane-profile-banner-field-box--circle" : ""}`}
            >
              <span className="ane-profile-banner-field-label">{label}</span>
              <span className={`ane-profile-banner-field-value${mod === "id" ? " ane-profile-banner-field-value--id" : ""}`}>
                {value}
              </span>
            </div>
          ))}
        </div>
        <div className="ane-profile-banner-photo-wrap">
          {imgSrc ? (
            <img
              src={imgSrc}
              alt={profile.name}
              className="ane-profile-banner-photo"
              onError={() => setImgSrc(fallbackAvatar)}
            />
          ) : (
            <div className="ane-profile-banner-photo-placeholder">
              {(profile.name || "?")[0].toUpperCase()}
            </div>
          )}
        </div>
      </div>
      <div className="ane-profile-banner-email-box">
        <span className="ane-profile-banner-field-label">Email</span>
        <span className="ane-profile-banner-field-value">{profile.email || "—"}</span>
      </div>
    </div>
  );
};

// ─── AddEmployee (main) ───────────────────────────────────────────────────────

const AddEmployee = () => {
  const navigate = useNavigate();

  const [step,                 setStep]                = useState(0);
  const [saving,               setSaving]              = useState(false);
  const [showSuccess,          setShowSuccess]          = useState(false);
  const [profileErrors,        setProfileErrors]        = useState({});
  const [assetValidationError, setAssetValidationError] = useState("");
  const [submitError,          setSubmitError]          = useState(""); // replaces alert()
  const [profileResolved,      setProfileResolved]      = useState(false);
  const [profile,              setProfile]              = useState(EMPTY_PROFILE);
  const [activeTab,            setActiveTab]            = useState("Hardware");
  const [hwType,               setHwType]               = useState("Laptop");
  const [selectedHwUnits,      setSelectedHwUnits]      = useState({});
  const [selectedSw,           setSelectedSw]           = useState([]); // { name, quantity }
  const [selectedNonHw,        setSelectedNonHw]        = useState([]);
  const qtyHoldTimeoutRef = useRef(null);
  const qtyHoldIntervalRef = useRef(null);

  // Stable reference to asset units — re-read only when a storage event fires
  // (the useMemo deps include nothing from state so it reads once per mount;
  // child memos that need fresh data include allUnits.length as a dep signal)
  const allUnits = useMemo(() => getAssetUnitsFromStorage(), []); // eslint-disable-line

  // ── Derived data ──────────────────────────────────────────────────────────

  const availableHwUnits = useMemo(
    () =>
      allUnits.filter(
        (u) =>
          u.category === "Hardware" &&
          u.status   === "available" &&
          (u.hwType  || "").toLowerCase() === hwType.toLowerCase(),
      ),
    [hwType, allUnits], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const nonHwGroups = useMemo(
    () =>
      getInventoryFromStorage()
        .filter(
          (i) =>
            (i.category === "Accessories" || i.category === "Consumables") &&
            (i.availableQuantity || 0) > 0,
        )
        .map((i) => ({
          assetName:   i.name,
          category:    i.category,
          inventoryId: i.id,
          units:       Array(i.availableQuantity).fill({ assetId: i.id, inventoryId: i.id }),
        })),
    [allUnits], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const availableSwGroups = useMemo(() => {
    const byName = {};
    getSoftwareInventory()
      .filter((i) => i.status === "available")
      .forEach((item) => {
        if (!byName[item.name]) byName[item.name] = { name: item.name, licenses: [] };
        byName[item.name].licenses.push(item);
      });
    return Object.values(byName);
  }, [allUnits]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Selection counts ──────────────────────────────────────────────────────

  const hwCount     = Object.keys(selectedHwUnits).length;
  const swCount     = selectedSw.reduce((sum, a) => sum + (Number(a.quantity) || 0), 0);
  const nonHwCount  = selectedNonHw.reduce((sum, a) => sum + (Number(a.quantity) || 0), 0);
  const totalAssets = hwCount + swCount + nonHwCount;
  const accCount    = selectedNonHw
    .filter((a) => a.category === "Accessories")
    .reduce((sum, a) => sum + (Number(a.quantity) || 0), 0);
  const consCount   = selectedNonHw
    .filter((a) => a.category === "Consumables")
    .reduce((sum, a) => sum + (Number(a.quantity) || 0), 0);

  // ── Duplicate tag detection ───────────────────────────────────────────────

  const selectedUnitIds = useMemo(
    () => new Set(Object.keys(selectedHwUnits)),
    [selectedHwUnits],
  );

  const usedTagsInForm = useMemo(
    () => Object.values(selectedHwUnits).map((s) => s.assetTag.trim()).filter(Boolean),
    [selectedHwUnits],
  );

  const isTagDuplicate = useCallback(
    (tag, unitAssetId) => {
      if (!tag.trim() || tag.trim() === unitAssetId) return false;
      const otherIds = new Set(
        allUnits.filter((u) => !selectedUnitIds.has(u.assetId)).map((u) => u.assetId),
      );
      if (otherIds.has(tag.trim())) return true;
      return usedTagsInForm.filter((t) => t === tag.trim()).length > 1;
    },
    [allUnits, selectedUnitIds, usedTagsInForm],
  );

  // ── Profile handlers ──────────────────────────────────────────────────────

  const handleLookupFound = useCallback((emp) => {
    const photo = emp.photo || "";
    setProfile({
      employeeId: emp.id || emp.empId || "",
      name:       emp.name   || "",
      type:       emp.type   || "",
      circle:     emp.circle || "",
      email:      emp.email  || "",
      photoUrl:   photo && !photo.startsWith("data:") ? photo : "",
      photoFile:  photo &&  photo.startsWith("data:") ? photo : null,
    });
    setProfileErrors({});
    setProfileResolved(true);
  }, []);

  const handleLookupReset = useCallback(() => {
    setProfileResolved(false);
    setProfile(EMPTY_PROFILE);
    setProfileErrors({});
  }, []);

  const validateProfile = useCallback(() => {
    const e = {};
    if (!profile.employeeId.trim()) e.employeeId = "Employee ID is required";
    if (!profile.name.trim())       e.name       = "Name is required";
    if (!profile.email.trim())      e.email      = "Email is required";
    else if (!/\S+@\S+\.\S+/.test(profile.email)) e.email = "Invalid email";
    setProfileErrors(e);
    return Object.keys(e).length === 0;
  }, [profile]);

  // ── Asset selection handlers ───────────────────────────────────────────────

  const toggleHwUnit = useCallback((unit) => {
    setAssetValidationError("");
    setSelectedHwUnits((prev) => {
      const next = { ...prev };
      if (next[unit.assetId]) delete next[unit.assetId];
      else next[unit.assetId] = { unit, assetTag: unit.assetId || "" };
      return next;
    });
  }, []);

  const setAssetTag = useCallback(
    (assetId, tag) =>
      setSelectedHwUnits((prev) => ({
        ...prev,
        [assetId]: { ...prev[assetId], assetTag: tag },
      })),
    [],
  );

  const setAssignmentPhoto = useCallback(
    (assetId, photos) =>
      setSelectedHwUnits((prev) => ({
        ...prev,
        [assetId]: { ...prev[assetId], assignmentPhotos: photos },
      })),
    [],
  );

  const toggleSw = useCallback((name) => {
    setAssetValidationError("");
    setSelectedSw((prev) => {
      const exists = prev.find((a) => a.name === name);
      if (exists) return prev.filter((a) => a.name !== name);
      return [...prev, { name, quantity: 1 }];
    });
  }, []);

  const adjustSwQuantity = useCallback((name, delta, maxAllowed) => {
    setSelectedSw((prev) =>
      prev.map((a) => {
        if (a.name !== name) return a;
        const current = Math.max(1, Number(a.quantity) || 1);
        const nextQty = Math.max(1, Math.min(maxAllowed, current + delta));
        return { ...a, quantity: nextQty };
      }),
    );
  }, []);

  const toggleNonHw = useCallback(
    (assetName, category) => {
      setAssetValidationError("");
      const key = `${assetName}||${category}`;
      setSelectedNonHw((prev) => {
        const exists = prev.find((a) => `${a.assetName}||${a.category}` === key);
        if (exists) return prev.filter((a) => `${a.assetName}||${a.category}` !== key);
        const group = nonHwGroups.find((g) => `${g.assetName}||${g.category}` === key);
        if (!group?.units.length) return prev;
        return [
          ...prev,
          {
            assetId: group.inventoryId,
            assetName,
            category,
            inventoryId: group.inventoryId,
            quantity: 1,
          },
        ];
      });
    },
    [nonHwGroups],
  );

  const setNonHwQuantity = useCallback((assetName, category, quantity, maxAllowed) => {
    const key = `${assetName}||${category}`;
    const nextQty = Math.max(1, Math.min(maxAllowed, Number(quantity) || 1));
    setSelectedNonHw((prev) =>
      prev.map((a) =>
        `${a.assetName}||${a.category}` === key
          ? { ...a, quantity: nextQty }
          : a,
      ),
    );
  }, []);

  const adjustNonHwQuantity = useCallback((assetName, category, delta, maxAllowed) => {
    const key = `${assetName}||${category}`;
    setSelectedNonHw((prev) =>
      prev.map((a) => {
        if (`${a.assetName}||${a.category}` !== key) return a;
        const current = Math.max(1, Number(a.quantity) || 1);
        const nextQty = Math.max(1, Math.min(maxAllowed, current + delta));
        return { ...a, quantity: nextQty };
      }),
    );
  }, []);

  const stopQtyHold = useCallback(() => {
    if (qtyHoldTimeoutRef.current) {
      clearTimeout(qtyHoldTimeoutRef.current);
      qtyHoldTimeoutRef.current = null;
    }
    if (qtyHoldIntervalRef.current) {
      clearInterval(qtyHoldIntervalRef.current);
      qtyHoldIntervalRef.current = null;
    }
  }, []);

  const startQtyHold = useCallback((assetName, category, delta, maxAllowed) => {
    stopQtyHold();
    qtyHoldTimeoutRef.current = setTimeout(() => {
      qtyHoldIntervalRef.current = setInterval(() => {
        adjustNonHwQuantity(assetName, category, delta, maxAllowed);
      }, 90);
    }, 320);
  }, [adjustNonHwQuantity, stopQtyHold]);

  const startSwQtyHold = useCallback((name, delta, maxAllowed) => {
    stopQtyHold();
    qtyHoldTimeoutRef.current = setTimeout(() => {
      qtyHoldIntervalRef.current = setInterval(() => {
        adjustSwQuantity(name, delta, maxAllowed);
      }, 90);
    }, 320);
  }, [adjustSwQuantity, stopQtyHold]);

  React.useEffect(() => () => stopQtyHold(), [stopQtyHold]);

  // ── Navigation ────────────────────────────────────────────────────────────

  const goNext = useCallback(() => {
    setSubmitError("");
    if (step === 0 && !profileResolved) return;
    if (step === 0 && !validateProfile()) return;
    if (step === 1 && totalAssets === 0) {
      setAssetValidationError("Please assign at least one asset before continuing.");
      return;
    }
    setAssetValidationError("");
    setStep((s) => Math.min(s + 1, 2));
  }, [step, profileResolved, validateProfile, totalAssets]);

  const goBack = useCallback(() => setStep((s) => Math.max(s - 1, 0)), []);

  // ── Submit ─────────────────────────────────────────────────────────────────

  const handleSubmit = useCallback(async () => {
    setSubmitError("");
    const empId   = profile.employeeId.trim();
    const empName = profile.name.trim();

    // Guard: profile completeness
    if (!empId || !empName || !profile.email.trim()) {
      setSubmitError("Some required profile fields are missing. Please go back to Step 1.");
      setStep(0);
      return;
    }

    // Guard: all selected HW units have an asset tag
    if (Object.values(selectedHwUnits).some((s) => !s?.assetTag?.trim())) {
      setSubmitError("Asset ID is missing for one or more hardware units.");
      setStep(1);
      return;
    }

    // Guard: duplicate tag detection
    const selectedEntries = Object.values(selectedHwUnits);
    const ownIds   = new Set(selectedEntries.map((s) => s.unit.assetId));
    const otherIds = new Set(
      getAssetUnitsFromStorage()
        .filter((u) => !ownIds.has(u.assetId))
        .map((u) => u.assetId),
    );
    const seenTags = new Set();
    let dupTag     = null;

    for (const { unit, assetTag } of selectedEntries) {
      const tag = assetTag.trim();
      if ((tag !== unit.assetId && otherIds.has(tag)) || seenTags.has(tag)) {
        dupTag = tag;
        break;
      }
      seenTags.add(tag);
    }

    if (dupTag) {
      setSubmitError(`Asset ID "${dupTag}" is already in use. Each unit must have a unique ID.`);
      setStep(1);
      return;
    }

    try {
      setSaving(true);

      // 1. Persist hardware assignment to backend first.
      for (const { unit, assetTag, assignmentPhotos } of selectedEntries) {
        await assignUnitToEmployeeAPI({
          unitId: unit.id || unit.assetId,
          empId,
          assetTag: assetTag.trim(),
          assignmentPhotos: assignmentPhotos || [],
        });
      }

      // Keep local shape in sync for screens that still read local employee data.
      saveAssetUnitsToStorage(
        getAssetUnitsFromStorage().map((u) => {
          const sel = selectedEntries.find((s) => s.unit.assetId === u.assetId);
          if (!sel) return u;
          return {
            ...u,
            status: "assigned",
            assignedTo: { empId, name: empName },
            assignedDate: new Date().toISOString(),
            assetTag: sel.assetTag.trim(),
            assignmentPhotos: sel.assignmentPhotos || [],
          };
        }),
      );

      // 2. Sync Accessories / Consumables inventory counts
      if (selectedNonHw.length) {
        const changes = {};
        selectedNonHw.forEach(({ assetName, category, inventoryId, quantity }) => {
          const key = inventoryId || `${assetName}||${category}`;
          if (!changes[key]) changes[key] = { inventoryId, assetName, category, count: 0 };
          changes[key].count += Math.max(1, Number(quantity) || 1);
        });
        for (const change of Object.values(changes)) {
          const targetInventoryId = change.inventoryId;
          if (!targetInventoryId) {
            throw new Error(`Missing inventory id for ${change.assetName}`);
          }
          await assignInventoryQuantityAPI({
            inventoryItemId: targetInventoryId,
            quantity: change.count,
            action: "assign",
            empId,
          });
        }
      }

      // 3. Mark software licenses as assigned (API + local mirror)
      const assignedSwLicenses = [];
      if (selectedSw.length) {
        const swInv   = getSoftwareInventory();
        const usedIds = new Set();

        for (const { name, quantity } of selectedSw) {
          const qty = Math.max(1, Number(quantity) || 1);
          for (let i = 0; i < qty; i += 1) {
            const license = swInv.find(
              (item) =>
                item.name === name &&
                item.status === "available" &&
                !usedIds.has(item.id),
            );
            if (!license) break;
            await assignSoftwareToEmployeeAPI({ licenseId: license.id, empId });
            license.status     = "assigned";
            license.assignedTo = empId;
            usedIds.add(license.id);
            assignedSwLicenses.push({ name, license });
          }
        }
        saveSoftwareInventory(swInv);

        const swCatalog = getInventoryFromStorage();
        const swQtyByName = {};
        assignedSwLicenses.forEach(({ name }) => {
          swQtyByName[name] = (swQtyByName[name] || 0) + 1;
        });
        Object.entries(swQtyByName).forEach(([name, count]) => {
          const idx = swCatalog.findIndex(
            (i) =>
              (i.category || "").toLowerCase() === "software" &&
              (i.name     || "").trim().toLowerCase() === name.trim().toLowerCase(),
          );
          if (idx !== -1) {
            swCatalog[idx] = {
              ...swCatalog[idx],
              availableQuantity: Math.max(
                0,
                (Number(swCatalog[idx].availableQuantity) || 0) - count,
              ),
              assignedQuantity: (Number(swCatalog[idx].assignedQuantity) || 0) + count,
            };
          }
        });
        saveInventoryToStorage(swCatalog);
      }

      await syncITDataFromAPI();

      // 4. Build assignedAssets array for the employee record
      const assignedAssets = [
        ...selectedEntries.map(({ unit, assetTag, assignmentPhotos }) => ({
          id:           unit.assetId,
          assetId:      unit.assetId,
          assetTag:     assetTag.trim(),
          name:         unit.assetName,
          category:     "Hardware",
          hwType:       unit.hwType,
          status:       "Assigned",
          brand:        unit.brand        || "",
          make:         unit.make         || "",
          model:        unit.model        || "",
          serialNumber: unit.serialNumber || "",
          imei1:        unit.imei1        || null,
          imei2:        unit.imei2        || null,
          photos:       assignmentPhotos  || [],
          assignedDate: new Date().toISOString(),
        })),

        ...assignedSwLicenses.map(({ name, license }) => ({
          id:                generateAssetId(),
          licenseId:         license?.id || null,
          assetId:           null,
          assetTag:          null,
          name,
          category:          "Software",
          status:            "Assigned",
          subscriptionStart: license?.subscriptionStart || null,
          subscriptionEnd:   license?.subscriptionEnd   || null,
          usageStatus:       "Active",
          photos:            [],
          assignedDate:      new Date().toISOString(),
        })),

        ...selectedNonHw.map(({ assetName, category, inventoryId, quantity }) => ({
          id:          generateAssetId(),
          assetId:     null,
          assetTag:    null,
          inventoryId: inventoryId || null,
          name:        assetName,
          category,
          quantity:    Math.max(1, Number(quantity) || 1),
          status:      "Assigned",
          photos:      [],
          assignedDate: new Date().toISOString(),
        })),
      ];

      // 5. Update employee record
      const currentEmployees = getEmployeesSafe();
      saveEmployees(
        currentEmployees.map((emp) => {
          if ((emp.id || emp.empId || "").toUpperCase() !== empId.toUpperCase()) return emp;
          return {
            ...emp,
            activated:      true,
            assignedAssets: [...(emp.assignedAssets || []), ...assignedAssets],
          };
        }),
      );

      // 6. Notify all listening dashboards
      try { window.dispatchEvent(new Event("inventory-updated")); } catch (_) {}

      setShowSuccess(true);
    } catch (err) {
      setSaving(false);
      console.error("[AddEmployee] handleSubmit error:", err);
      const msg = getITApiErrorMessage(
        err,
        "Could not save this employee on the server. Please try again.",
      );
      toast.error(msg);
      setSubmitError(`Failed to save employee: ${msg}`);
    }
  }, [profile, selectedHwUnits, selectedNonHw, selectedSw]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="ane-page">

      {/* Top bar */}
      <div className="ane-topbar">
        <button className="ane-back-btn" onClick={() => navigate(-1)}>← Back</button>
        <h1 className="ane-page-title">Add New Employee</h1>
        <div className="ane-step-pills">
          {STEPS.map((s, i) => (
            <div
              key={s}
              className={`ane-step-pill${i === step ? " active" : i < step ? " done" : ""}`}
            >
              <span className="ane-step-circle">{i < step ? "✓" : i + 1}</span>
              <span className="ane-step-name">{s}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="ane-body">

        {/* Inline error banner (replaces alert()) */}
        {submitError && (
          <div className="ane-submit-error">
            ⚠ {submitError}
          </div>
        )}

        {/* ── STEP 0: Profile ── */}
        {step === 0 && (
          <div className="ane-card">
            <div className="ane-card-head">
              <span className="ane-card-icon">👤</span>
              <div>
                <h2>Employee Profile</h2>
                {!profileResolved && (
                  <p>Enter Employee ID or Email to auto-fetch the profile.</p>
                )}
              </div>
            </div>
            {!profileResolved
              ? <LookupGate onFound={handleLookupFound} />
              : <ProfileSummaryBanner profile={profile} onReset={handleLookupReset} />
            }
          </div>
        )}

        {/* ── STEP 1: Assign Assets ── */}
        {step === 1 && (
          <div className="ane-card">
            <div className="ane-card-head">
              <span className="ane-card-icon">📦</span>
              <div>
                <h2>Assign Assets</h2>
                <p>Choose assets to assign to <strong>{profile.name}</strong></p>
              </div>
            </div>

            {/* Category tabs */}
            <div className="ane-cat-tabs">
              {ASSIGN_CATS.map((cat) => {
                const count =
                  cat === "Hardware"
                    ? hwCount
                    : cat === "Software"
                      ? swCount
                      : selectedNonHw
                          .filter((a) => a.category === cat)
                          .reduce((sum, a) => sum + (Number(a.quantity) || 0), 0);
                return (
                  <button
                    key={cat}
                    className={`ane-cat-tab${activeTab === cat ? " active" : ""}`}
                    onClick={() => setActiveTab(cat)}
                  >
                    <span className="ane-tab-icon">{TAB_ICONS[cat]}</span>
                    {cat}
                    {count > 0 && <span className="ane-tab-badge">{count}</span>}
                  </button>
                );
              })}
            </div>

            {/* Hardware tab */}
            {activeTab === "Hardware" && (
              <div className="ane-hw-panel">
                <div className="ane-hw-type-row">
                  <span className="ane-hw-type-label">Hardware Type:</span>
                  <div className="ane-hw-type-chips">
                    {HW_TYPES.map((t) => (
                      <button
                        key={t}
                        className={`ane-hw-chip${hwType === t ? " active" : ""}`}
                        onClick={() => setHwType(t)}
                      >
                        {HW_TYPE_ICONS[t]} {t}
                      </button>
                    ))}
                  </div>
                </div>

                {availableHwUnits.length === 0 ? (
                  <div className="ane-hw-empty">
                    <div className="ane-hw-empty-icon">📭</div>
                    <p>No available <strong>{hwType}</strong> units in inventory.</p>
                    <span className="ane-hint">Add more {hwType}s via Inventory → Add Assets</span>
                  </div>
                ) : (
                  <div className="ane-hw-table-wrap">
                    <div className="ane-hw-table-info">
                      Showing <strong>{availableHwUnits.length}</strong> available {hwType}(s).
                    </div>
                    <table className="ane-hw-table">
                      <thead>
                        <tr>
                          <th className="ane-hw-th-check">Select</th>
                          <th>Brand</th><th>Make</th><th>Model</th><th>Serial Number</th>
                          {hwType === "Mobile" && <th>IMEI 1</th>}
                          <th>Asset ID</th><th>Photo</th>
                        </tr>
                      </thead>
                      <tbody>
                        {availableHwUnits.map((unit) => {
                          const isSelected     = !!selectedHwUnits[unit.assetId];
                          const tagVal         = selectedHwUnits[unit.assetId]?.assetTag ?? "";
                          const isDuplicate    = isSelected && isTagDuplicate(tagVal, unit.assetId);
                          const assignedPhotos = selectedHwUnits[unit.assetId]?.assignmentPhotos || [];

                          return (
                            <tr
                              key={unit.assetId}
                              className={`ane-hw-row${isSelected ? " selected" : ""}`}
                            >
                              <td>
                                <input
                                  type="checkbox"
                                  className="ane-hw-checkbox"
                                  checked={isSelected}
                                  onChange={() => toggleHwUnit(unit)}
                                />
                              </td>
                              <td><span className="ane-hw-val">{unit.brand || "—"}</span></td>
                              <td><span className="ane-hw-val">{unit.make  || "—"}</span></td>
                              <td><span className="ane-hw-val">{unit.model || "—"}</span></td>
                              <td><span className="ane-hw-mono">{unit.serialNumber || unit.assetId}</span></td>
                              {hwType === "Mobile" && (
                                <td><span className="ane-hw-mono">{unit.imei1 || "—"}</span></td>
                              )}
                              <td>
                                {isSelected ? (
                                  <div className="ane-tag-cell">
                                    <input
                                      type="text"
                                      className={`ane-tag-input${isDuplicate ? " err" : tagVal ? " ok" : ""}`}
                                      value={tagVal}
                                      onChange={(e) => setAssetTag(unit.assetId, e.target.value)}
                                    />
                                    {isDuplicate && <span className="ane-tag-err">Already in use</span>}
                                    {!isDuplicate && tagVal && <span className="ane-tag-ok">✓</span>}
                                  </div>
                                ) : (
                                  <span className="ane-hw-mono ane-hw-mono--muted">{unit.assetId}</span>
                                )}
                              </td>
                              <td>
                                {isSelected ? (
                                  <label className="ane-photo-upload-btn" title="Upload assignment photo">
                                    <input
                                      type="file"
                                      accept="image/*"
                                      multiple
                                      style={{ display: "none" }}
                                      onChange={async (e) => {
                                        const files = Array.from(e.target.files);
                                        if (!files.length) return;
                                        const compressed = await Promise.all(files.map(compressImage));
                                        setAssignmentPhoto(unit.assetId, [...assignedPhotos, ...compressed]);
                                      }}
                                    />
                                    {assignedPhotos.length > 0 ? `📷 (${assignedPhotos.length})` : "📷 Add"}
                                  </label>
                                ) : (
                                  <span className="ane-hw-mono ane-hw-mono--muted">—</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>

                    {hwCount > 0 && (
                      <div className="ane-hw-selected-summary">
                        {hwCount} {hwType}(s) selected
                        {Object.values(selectedHwUnits).some((s) => !s.assetTag.trim()) && (
                          <span className="ane-hw-warn"> — Some units are missing an Asset ID</span>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Software tab */}
            {activeTab === "Software" && (
              <div className="ane-checklist">
                {availableSwGroups.length === 0 ? (
                  <div className="ane-checklist-empty">
                    No software licenses available. Add licenses via Inventory → Add Assets.
                  </div>
                ) : (
                  availableSwGroups.map(({ name, licenses }) => {
                    const selectedEntry = selectedSw.find((a) => a.name === name);
                    const isChecked = !!selectedEntry;
                    const qty = Math.max(1, Number(selectedEntry?.quantity) || 1);
                    const maxQty = licenses.length;
                    return (
                      <label
                        key={name}
                        className={`ane-check-item${isChecked ? " checked" : ""}`}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleSw(name)}
                        />
                        <span className="ane-check-icon">💿</span>
                        <span className="ane-check-name">{name}</span>
                        <span className="ane-stock-tag in-stock">{maxQty} available</span>
                        {isChecked && (
                          <div
                            className="ane-qty-stepper"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              className="ane-qty-btn"
                              disabled={qty <= 1}
                              onClick={(e) => {
                                e.preventDefault();
                                adjustSwQuantity(name, -1, maxQty);
                              }}
                              onMouseDown={(e) => {
                                e.preventDefault();
                                startSwQtyHold(name, -1, maxQty);
                              }}
                              onMouseUp={stopQtyHold}
                              onMouseLeave={stopQtyHold}
                              onTouchStart={(e) => {
                                e.preventDefault();
                                startSwQtyHold(name, -1, maxQty);
                              }}
                              onTouchEnd={stopQtyHold}
                              onTouchCancel={stopQtyHold}
                            >
                              −
                            </button>
                            <span className="ane-qty-value">{qty}</span>
                            <button
                              type="button"
                              className="ane-qty-btn"
                              disabled={qty >= maxQty}
                              onClick={(e) => {
                                e.preventDefault();
                                adjustSwQuantity(name, 1, maxQty);
                              }}
                              onMouseDown={(e) => {
                                e.preventDefault();
                                startSwQtyHold(name, 1, maxQty);
                              }}
                              onMouseUp={stopQtyHold}
                              onMouseLeave={stopQtyHold}
                              onTouchStart={(e) => {
                                e.preventDefault();
                                startSwQtyHold(name, 1, maxQty);
                              }}
                              onTouchEnd={stopQtyHold}
                              onTouchCancel={stopQtyHold}
                            >
                              +
                            </button>
                          </div>
                        )}
                      </label>
                    );
                  })
                )}
              </div>
            )}

            {/* Accessories / Consumables tab */}
            {(activeTab === "Accessories" || activeTab === "Consumables") && (
              <div className="ane-checklist">
                {nonHwGroups.filter((g) => g.category === activeTab).length === 0 ? (
                  <div className="ane-checklist-empty">
                    No available {activeTab} in inventory.
                  </div>
                ) : (
                  nonHwGroups
                    .filter((g) => g.category === activeTab)
                    .map((g) => {
                      const key     = `${g.assetName}||${g.category}`;
                      const selectedEntry = selectedNonHw.find(
                        (a) => `${a.assetName}||${a.category}` === key,
                      );
                      const isChecked = !!selectedEntry;
                      const qty = Math.max(1, Number(selectedEntry?.quantity) || 1);
                      const maxQty = g.units.length;
                      return (
                        <label
                          key={key}
                          className={`ane-check-item${isChecked ? " checked" : ""}`}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggleNonHw(g.assetName, g.category)}
                          />
                          <span className="ane-check-icon">
                            {activeTab === "Accessories" ? "🖱️" : "📦"}
                          </span>
                          <span className="ane-check-name">{g.assetName}</span>
                          <span className="ane-stock-tag in-stock">{g.units.length} available</span>
                          {isChecked && (
                            <div
                              className="ane-qty-stepper"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                type="button"
                                className="ane-qty-btn"
                                disabled={qty <= 1}
                                onClick={(e) => {
                                  e.preventDefault();
                                  adjustNonHwQuantity(g.assetName, g.category, -1, maxQty);
                                }}
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  startQtyHold(g.assetName, g.category, -1, maxQty);
                                }}
                                onMouseUp={stopQtyHold}
                                onMouseLeave={stopQtyHold}
                                onTouchStart={(e) => {
                                  e.preventDefault();
                                  startQtyHold(g.assetName, g.category, -1, maxQty);
                                }}
                                onTouchEnd={stopQtyHold}
                                onTouchCancel={stopQtyHold}
                              >
                                −
                              </button>
                              <span className="ane-qty-value">{qty}</span>
                              <button
                                type="button"
                                className="ane-qty-btn"
                                disabled={qty >= maxQty}
                                onClick={(e) => {
                                  e.preventDefault();
                                  adjustNonHwQuantity(g.assetName, g.category, 1, maxQty);
                                }}
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  startQtyHold(g.assetName, g.category, 1, maxQty);
                                }}
                                onMouseUp={stopQtyHold}
                                onMouseLeave={stopQtyHold}
                                onTouchStart={(e) => {
                                  e.preventDefault();
                                  startQtyHold(g.assetName, g.category, 1, maxQty);
                                }}
                                onTouchEnd={stopQtyHold}
                                onTouchCancel={stopQtyHold}
                              >
                                +
                              </button>
                            </div>
                          )}
                        </label>
                      );
                    })
                )}
              </div>
            )}

            {/* Selection summary bar */}
            {totalAssets > 0 && (
              <div className="ane-selection-bar">
                <span className="ane-selection-title">Selected:</span>
                {hwCount   > 0 && <span className="ane-sel-chip hardware">{hwCount} Hardware</span>}
                {swCount   > 0 && <span className="ane-sel-chip software">{swCount} Software</span>}
                {accCount  > 0 && <span className="ane-sel-chip accessories">{accCount} Accessories</span>}
                {consCount > 0 && <span className="ane-sel-chip consumables">{consCount} Consumables</span>}
                <span className="ane-sel-total">Total: {totalAssets}</span>
              </div>
            )}

            {assetValidationError && (
              <div className="ane-asset-validation-error">
                <span className="ane-asset-validation-error-icon">⚠️</span>
                <span>{assetValidationError}</span>
              </div>
            )}
          </div>
        )}

        {/* ── STEP 2: Review ── */}
        {step === 2 && (
          <div className="ane-card">
            <div className="ane-card-head">
              <span className="ane-card-icon">✅</span>
              <div>
                <h2>Review &amp; Confirm</h2>
                <p>Double-check everything before saving</p>
              </div>
            </div>

            <div className="ane-review-section">
              <h3 className="ane-review-section-title">👤 Employee Profile</h3>
              <div className="ane-review-profile">
                <img
                  className="ane-review-photo"
                  src={
                    profile.photoUrl ||
                    profile.photoFile ||
                    `https://ui-avatars.com/api/?name=${encodeURIComponent(profile.name)}&background=4CAF50&color=fff`
                  }
                  alt={profile.name}
                />
                <div className="ane-review-details">
                  {[
                    ["Employee ID", profile.employeeId],
                    ["Name",        profile.name],
                    ["Type",        profile.type],
                    ["Circle",      profile.circle],
                    ["Email",       profile.email],
                  ].map(([label, val]) => (
                    <div key={label} className="ane-review-row">
                      <span className="ane-review-label">{label}</span>
                      <span className="ane-review-val">{val || "—"}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {totalAssets > 0 ? (
              <div className="ane-review-section">
                <h3 className="ane-review-section-title">
                  Assets to Assign ({totalAssets})
                </h3>

                {hwCount > 0 && (
                  <div className="ane-review-asset-group">
                    <div className="ane-review-group-label">
                      <span className="ane-rdot hardware" /> Hardware ({hwCount})
                    </div>
                    <table className="ane-review-table">
                      <thead>
                        <tr>
                          <th>Asset Name</th>
                          <th>Brand / Model</th>
                          <th>Serial Number</th>
                          <th>Asset ID</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.values(selectedHwUnits).map(({ unit, assetTag }) => (
                          <tr key={unit.assetId}>
                            <td><strong>{unit.assetName}</strong></td>
                            <td>{unit.brand} {unit.model}</td>
                            <td><span className="ane-review-mono">{unit.serialNumber || unit.assetId}</span></td>
                            <td>
                              {assetTag
                                ? <span className="ane-review-tag">{assetTag}</span>
                                : <span className="ane-review-missing">Missing!</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {swCount > 0 && (
                  <div className="ane-review-asset-group">
                    <div className="ane-review-group-label">
                      <span className="ane-rdot software" /> Software ({swCount})
                    </div>
                    <div className="ane-review-pill-list">
                      {selectedSw.map(({ name, quantity }) => (
                        <span key={name} className="ane-review-pill">
                          {name}
                          <span className="ane-review-pill-cat">
                            x{Math.max(1, Number(quantity) || 1)}
                          </span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {nonHwCount > 0 && (
                  <div className="ane-review-asset-group">
                    <div className="ane-review-group-label">
                      <span className="ane-rdot other" /> Accessories &amp; Consumables ({nonHwCount})
                    </div>
                    <div className="ane-review-pill-list">
                      {selectedNonHw.map((a) => (
                        <span key={a.assetId} className="ane-review-pill">
                          {a.assetName}
                          <span className="ane-review-pill-cat">x{Math.max(1, Number(a.quantity) || 1)}</span>
                          <span className="ane-review-pill-cat">{a.category}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="ane-review-no-assets">
                <span>ℹ</span> No assets selected — employee will be created with no assigned assets.
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="ane-footer">
          <div className="ane-footer-left">
            {step > 0 && (
              <button className="ane-btn-back" onClick={goBack}>← Back</button>
            )}
          </div>
          <div className="ane-footer-right">
            <button className="ane-btn-cancel" onClick={() => navigate(-1)}>Cancel</button>
            {step < 2 ? (
              <button className="ane-btn-next" onClick={goNext}>Next →</button>
            ) : (
              <button
                className="ane-btn-submit"
                onClick={handleSubmit}
                disabled={saving}
                aria-busy={saving}
              >
                {saving ? "⏳ Saving…" : "✅ Save Employee"}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Success popup */}
      {showSuccess && (
        <SuccessPopup
          employeeName={profile.name.trim()}
          totalAssets={totalAssets}
          onClose={() => navigate(-1)}
        />
      )}
    </div>
  );
};

export default AddEmployee;


