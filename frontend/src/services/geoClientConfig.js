const API_BASE_URL = import.meta.env.VITE_API_URL || "";

const DEFAULTS = Object.freeze({
  dashboard: {
    pollIntervalMs: 75000,
    staleThresholdMs: 300000,
    minRecheckMs: 45000,
    cacheMaxAgeMs: 60000,
    highAccuracyRefineDelayMs: 4000,
    idleCallbackTimeoutMs: 150,
    highAccuracyTimeoutMs: 8000,
    lowAccuracyTimeoutMs: 3000,
    highAccuracyMaxAgeMs: 60000,
    lowAccuracyMaxAgeMs: 90000,
  },
  punch: {
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
  },
});

let _cached = null;
let _fetchPromise = null;

export function getGeoClientConfig() {
  if (_cached) return _cached;
  return DEFAULTS;
}

export async function loadGeoClientConfig() {
  if (_cached) return _cached;
  if (_fetchPromise) return _fetchPromise;
  _fetchPromise = (async () => {
    try {
      const token = localStorage.getItem("token");
      if (!token) { _cached = DEFAULTS; return DEFAULTS; }
      const res = await fetch(`${API_BASE_URL}/employee/geo/client-config`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) { _cached = DEFAULTS; return DEFAULTS; }
      const data = await res.json();
      _cached = {
        dashboard: { ...DEFAULTS.dashboard, ...data.dashboard },
        punch: { ...DEFAULTS.punch, ...data.punch },
      };
      return _cached;
    } catch {
      _cached = DEFAULTS;
      return DEFAULTS;
    } finally {
      _fetchPromise = null;
    }
  })();
  return _fetchPromise;
}

export function resetGeoClientConfigCache() {
  _cached = null;
  _fetchPromise = null;
}

export { DEFAULTS as GEO_CLIENT_DEFAULTS };
