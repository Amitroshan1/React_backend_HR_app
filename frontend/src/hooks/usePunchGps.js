import { useCallback, useRef, useState } from "react";
import {
  GPS_STATUS_MESSAGES,
  PunchGpsState,
  acquireGpsFix,
} from "../services/gpsAcquisition";
import { getGeoClientConfig } from "../services/geoClientConfig";

/**
 * Shared punch GPS state machine for Punch In and Punch Out.
 * Acquires a fresh fix by default. Dashboard may skip this via Trusted Location Cache
 * (INSIDE-only) before calling acquireForPunch.
 */
export function usePunchGps() {
  const [state, setState] = useState(PunchGpsState.IDLE);
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState(null);
  const abortRef = useRef(null);

  const reset = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setState(PunchGpsState.IDLE);
    setStatusMessage("");
    setErrorMessage(null);
  }, []);

  const setPunchState = useCallback((next, message) => {
    setState(next);
    setStatusMessage(
      message != null ? message : GPS_STATUS_MESSAGES[next] || "",
    );
    if (next !== PunchGpsState.ERROR) setErrorMessage(null);
  }, []);

  /**
   * Fresh GPS acquisition for punch. Returns measurement or null on failure.
   */
  const acquireForPunch = useCallback(async () => {
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setErrorMessage(null);
    setPunchState(PunchGpsState.REQUESTING_PERMISSION);

    try {
      const result = await acquireGpsFix({
        signal: controller.signal,
        config: getGeoClientConfig().punch,
        onProgress: ({ state: s, message }) => {
          setState(s);
          setStatusMessage(message || GPS_STATUS_MESSAGES[s] || "");
        },
      });

      if (controller.signal.aborted) {
        setPunchState(PunchGpsState.IDLE);
        return { ok: false, cancelled: true, measurement: null };
      }

      if (!result.ok || !result.measurement) {
        setPunchState(PunchGpsState.ERROR, result.message);
        setErrorMessage(result.message);
        return {
          ok: false,
          cancelled: false,
          errorCode: result.errorCode,
          message: result.message,
          measurement: null,
        };
      }

      if (result.lowSignal) {
        setPunchState(PunchGpsState.LOW_SIGNAL);
      } else {
        setPunchState(PunchGpsState.READY);
      }

      return {
        ok: true,
        cancelled: false,
        lowSignal: !!result.lowSignal,
        measurement: result.measurement,
        message: result.message,
      };
    } catch (err) {
      if (err?.name === "AbortError") {
        setPunchState(PunchGpsState.IDLE);
        return { ok: false, cancelled: true, measurement: null };
      }
      const message =
        err?.message || "Unable to read GPS location. Please try again.";
      setPunchState(PunchGpsState.ERROR, message);
      setErrorMessage(message);
      return { ok: false, cancelled: false, message, measurement: null };
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [setPunchState]);

  const isBusy =
    state === PunchGpsState.REQUESTING_PERMISSION ||
    state === PunchGpsState.ACQUIRING_LOCATION ||
    state === PunchGpsState.IMPROVING_ACCURACY ||
    state === PunchGpsState.SUBMITTING;

  return {
    state,
    statusMessage,
    errorMessage,
    isBusy,
    acquireForPunch,
    setPunchState,
    reset,
    PunchGpsState,
  };
}
