/**
 * GPS acquisition engine for Punch In / Punch Out.
 *
 * Uses getCurrentPosition() with controlled retries only — never watchPosition().
 * Background Location Check polling must NOT call this for punch coordinates.
 *
 * Spec (Geo-fence V2):
 * - Max 5 attempts, 12s wall clock, 1.5s inter-attempt delay
 * - enableHighAccuracy=true, maximumAge=0
 * - Best sample after outlier rejection (never average)
 * - Early stop when accuracy/spread thresholds are met
 */

export const GPS_ACQUISITION_DEFAULTS = Object.freeze({
  maxAttempts: 5,
  timeoutMs: 8000,
  totalTimeoutMs: 12000,
  interAttemptDelayMs: 1500,
  earlyStopAccuracyM: 30,
  earlyStopSpreadM: 50,
  earlyStopAccuracyLooseM: 50,
  earlyStopSpreadLooseM: 75,
  earlyStopMinSamples: 2,
  earlyStopMinSamplesLoose: 3,
  outlierMinMeters: 100,
  accMaxMobileM: 250,
  accMaxDesktopM: 400,
});

/** Punch / GPS UI state machine (single status; avoid scattered booleans). */
export const PunchGpsState = Object.freeze({
  IDLE: "IDLE",
  REQUESTING_PERMISSION: "REQUESTING_PERMISSION",
  ACQUIRING_LOCATION: "ACQUIRING_LOCATION",
  IMPROVING_ACCURACY: "IMPROVING_ACCURACY",
  READY: "READY",
  LOW_SIGNAL: "LOW_SIGNAL",
  OUTSIDE: "OUTSIDE",
  SUBMITTING: "SUBMITTING",
  SUCCESS: "SUCCESS",
  ERROR: "ERROR",
});

export const GPS_STATUS_MESSAGES = Object.freeze({
  [PunchGpsState.IDLE]: "",
  [PunchGpsState.REQUESTING_PERMISSION]: "Requesting location permission…",
  [PunchGpsState.ACQUIRING_LOCATION]: "Finding your location…",
  [PunchGpsState.IMPROVING_ACCURACY]: "Improving GPS accuracy…",
  [PunchGpsState.READY]: "Location Ready",
  [PunchGpsState.LOW_SIGNAL]: "Weak GPS Signal",
  [PunchGpsState.OUTSIDE]: "Outside office range",
  [PunchGpsState.SUBMITTING]: "Submitting Punch…",
  [PunchGpsState.SUCCESS]: "Location Verified",
  [PunchGpsState.ERROR]: "Location unavailable",
});

export function detectDeviceClass() {
  if (typeof navigator === "undefined") return "desktop";
  const ua = navigator.userAgent || "";
  if (/Android|iPhone|iPad|iPod|Mobile|webOS|BlackBerry|IEMobile|Opera Mini/i.test(ua)) {
    return "mobile";
  }
  return "desktop";
}

export function haversineMeters(lat1, lon1, lat2, lon2) {
  const r = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Pick best observed sample after outlier rejection. Never averages coordinates.
 * @returns {{ chosen: object|null, accepted: object[], spreadM: number|null }}
 */
export function selectBestSample(samples, cfg = GPS_ACQUISITION_DEFAULTS) {
  if (!samples || samples.length === 0) {
    return { chosen: null, accepted: [], spreadM: null };
  }

  const bestAccuracy = samples.reduce((best, s) =>
    s.accuracy < best.accuracy ? s : best,
  );

  const gate = Math.max(
    Number(cfg.outlierMinMeters) || 100,
    2 * Number(bestAccuracy.accuracy),
  );

  let accepted = samples.filter(
    (s) =>
      haversineMeters(s.lat, s.lon, bestAccuracy.lat, bestAccuracy.lon) <= gate,
  );
  if (accepted.length === 0) accepted = [bestAccuracy];

  const chosen = accepted.reduce((best, s) =>
    s.accuracy < best.accuracy ? s : best,
  );

  let spreadM = null;
  if (accepted.length >= 2) {
    let maxD = 0;
    for (let i = 0; i < accepted.length; i++) {
      for (let j = i + 1; j < accepted.length; j++) {
        const d = haversineMeters(
          accepted[i].lat,
          accepted[i].lon,
          accepted[j].lat,
          accepted[j].lon,
        );
        if (d > maxD) maxD = d;
      }
    }
    spreadM = maxD;
  }

  return { chosen, accepted, spreadM };
}

export function shouldEarlyStop(samples, cfg = GPS_ACQUISITION_DEFAULTS) {
  const { chosen, spreadM } = selectBestSample(samples, cfg);
  if (!chosen) return false;
  const n = samples.length;
  const acc = chosen.accuracy;
  const spread = spreadM == null ? Infinity : spreadM;

  if (
    n >= (cfg.earlyStopMinSamples || 2) &&
    acc <= (cfg.earlyStopAccuracyM || 30) &&
    spread <= (cfg.earlyStopSpreadM || 50)
  ) {
    return true;
  }
  if (
    n >= (cfg.earlyStopMinSamplesLoose || 3) &&
    acc <= (cfg.earlyStopAccuracyLooseM || 50) &&
    spread <= (cfg.earlyStopSpreadLooseM || 75)
  ) {
    return true;
  }
  return false;
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const t = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function getCurrentPositionOnce(options) {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve({ ok: false, code: "UNSUPPORTED", message: "Geolocation not supported by this browser." });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          ok: true,
          sample: {
            lat: pos.coords.latitude,
            lon: pos.coords.longitude,
            accuracy: Number(pos.coords.accuracy),
            timestamp: pos.timestamp || Date.now(),
          },
        });
      },
      (err) => {
        const code = err?.code;
        if (code === 1) {
          resolve({
            ok: false,
            code: "PERMISSION_DENIED",
            message:
              "Location permission denied. Enable location access in your browser settings and try again.",
          });
        } else if (code === 2) {
          resolve({
            ok: false,
            code: "POSITION_UNAVAILABLE",
            message:
              "Location is disabled or unavailable on this device. Check GPS / location services.",
          });
        } else if (code === 3) {
          resolve({
            ok: false,
            code: "TIMEOUT",
            message: "GPS timed out. Move near a window or try again outdoors.",
          });
        } else {
          resolve({
            ok: false,
            code: "UNAVAILABLE",
            message: err?.message || "Unable to read GPS location.",
          });
        }
      },
      options,
    );
  });
}

function newAttemptId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `gps-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Acquire a fresh GPS fix for punch (never reuse React-cached poll coords).
 *
 * @param {object} [opts]
 * @param {(info: { state: string, attempt: number, sampleCount: number, bestAccuracy: number|null, message: string }) => void} [opts.onProgress]
 * @param {AbortSignal} [opts.signal]
 * @param {Partial<typeof GPS_ACQUISITION_DEFAULTS>} [opts.config]
 */
export async function acquireGpsFix(opts = {}) {
  const cfg = { ...GPS_ACQUISITION_DEFAULTS, ...(opts.config || {}) };
  const onProgress = typeof opts.onProgress === "function" ? opts.onProgress : () => {};
  const signal = opts.signal;
  const attemptId = newAttemptId();
  const deviceClass = detectDeviceClass();
  const started = Date.now();
  const samples = [];
  let lastError = null;
  let permissionPrompted = false;

  const geoOpts = {
    enableHighAccuracy: true,
    maximumAge: 0,
    timeout: cfg.timeoutMs,
  };

  const emit = (state, attempt, extra = {}) => {
    const { chosen } = selectBestSample(samples, cfg);
    onProgress({
      state,
      attempt,
      sampleCount: samples.length,
      bestAccuracy: chosen ? chosen.accuracy : null,
      message: GPS_STATUS_MESSAGES[state] || "",
      ...extra,
    });
  };

  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return {
      ok: false,
      errorCode: "UNSUPPORTED",
      message: "Geolocation not supported by this browser.",
      measurement: null,
      attemptId,
    };
  }

  for (let attempt = 1; attempt <= cfg.maxAttempts; attempt++) {
    if (signal?.aborted) {
      return {
        ok: false,
        errorCode: "ABORTED",
        message: "Location request cancelled.",
        measurement: null,
        attemptId,
      };
    }
    if (Date.now() - started >= cfg.totalTimeoutMs) break;

    if (!permissionPrompted) {
      permissionPrompted = true;
      emit(PunchGpsState.REQUESTING_PERMISSION, attempt);
    } else if (samples.length === 0) {
      emit(PunchGpsState.ACQUIRING_LOCATION, attempt);
    } else {
      emit(PunchGpsState.IMPROVING_ACCURACY, attempt);
    }

    const remaining = cfg.totalTimeoutMs - (Date.now() - started);
    if (remaining <= 0) break;

    const result = await getCurrentPositionOnce({
      ...geoOpts,
      timeout: Math.min(cfg.timeoutMs, Math.max(500, remaining)),
    });

    if (signal?.aborted) {
      return {
        ok: false,
        errorCode: "ABORTED",
        message: "Location request cancelled.",
        measurement: null,
        attemptId,
      };
    }

    if (!result.ok) {
      lastError = result;
      if (result.code === "PERMISSION_DENIED") {
        return {
          ok: false,
          errorCode: "PERMISSION_DENIED",
          message: result.message,
          measurement: null,
          attemptId,
        };
      }
      // TIMEOUT / UNAVAILABLE — keep retrying within budget
    } else {
      samples.push(result.sample);
      if (shouldEarlyStop(samples, cfg)) break;
    }

    if (attempt < cfg.maxAttempts && Date.now() - started < cfg.totalTimeoutMs) {
      const wait = Math.min(
        cfg.interAttemptDelayMs,
        Math.max(0, cfg.totalTimeoutMs - (Date.now() - started)),
      );
      if (wait > 0) {
        try {
          await sleep(wait, signal);
        } catch {
          return {
            ok: false,
            errorCode: "ABORTED",
            message: "Location request cancelled.",
            measurement: null,
            attemptId,
          };
        }
      }
    }
  }

  const acquisitionMs = Date.now() - started;
  const { chosen, accepted, spreadM } = selectBestSample(samples, cfg);

  if (!chosen) {
    return {
      ok: false,
      errorCode: lastError?.code || "TIMEOUT",
      message:
        lastError?.message ||
        "Could not get a GPS fix in time. Try again near a window or outdoors.",
      measurement: null,
      attemptId,
      diagnostics: { sampleCount: 0, acquisitionMs, retryCount: samples.length },
    };
  }

  const accMax =
    deviceClass === "mobile" ? cfg.accMaxMobileM : cfg.accMaxDesktopM;
  const lowSignal = chosen.accuracy > accMax;

  const measurement = {
    lat: chosen.lat,
    lon: chosen.lon,
    accuracy_m: chosen.accuracy,
    sample_count: accepted.length,
    spread_m: spreadM,
    retry_count: Math.max(0, samples.length - 1),
    acquisition_ms: acquisitionMs,
    device_class: deviceClass,
    attempt_id: attemptId,
    low_signal: lowSignal,
  };

  return {
    ok: true,
    errorCode: null,
    message: lowSignal
      ? GPS_STATUS_MESSAGES[PunchGpsState.LOW_SIGNAL]
      : GPS_STATUS_MESSAGES[PunchGpsState.READY],
    measurement,
    attemptId,
    lowSignal,
    diagnostics: {
      rawSampleCount: samples.length,
      acceptedCount: accepted.length,
      spreadM,
      acquisitionMs,
    },
  };
}

/** Map location-check zone → UI pill label (poll indicator only). */
export function zoneToLocationLabel(zone, inRange) {
  switch (zone) {
    case "INSIDE":
      return { text: "Inside", tone: "on" };
    case "NEAR":
      return { text: "Approximate", tone: "approx" };
    case "OUTSIDE":
      return { text: "Outside", tone: "off" };
    case "NO_OFFICE_CONFIG":
      return { text: "No office set", tone: "approx" };
    case "NO_GPS":
    default:
      return {
        text: inRange ? "Within Range" : "Off",
        tone: inRange ? "on" : "off",
      };
  }
}
