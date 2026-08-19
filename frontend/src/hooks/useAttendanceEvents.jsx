/**
 * Phase 3D — Server-Sent Events for attendance.updated.
 * Polling (homepage) remains the fallback; SSE never mutates attendance.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export const ATTENDANCE_UPDATED_EVENT = "hrms:attendance-updated";

const AttendanceEventsContext = createContext(null);

function buildEventsUrl(token) {
  const q = new URLSearchParams({ access_token: token });
  return `/api/attendance/events?${q.toString()}`;
}

export function AttendanceEventsProvider({ children }) {
  const [connected, setConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState(null);
  const esRef = useRef(null);
  const backoffRef = useRef(1000);
  const reconnectTimerRef = useRef(null);
  const stoppedRef = useRef(false);

  const dispatchLocal = useCallback((payload) => {
    setLastEvent(payload);
    try {
      window.dispatchEvent(
        new CustomEvent(ATTENDANCE_UPDATED_EVENT, { detail: payload })
      );
    } catch {
      /* ignore */
    }
  }, []);

  const disconnect = useCallback(() => {
    stoppedRef.current = true;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (esRef.current) {
      try {
        esRef.current.close();
      } catch {
        /* ignore */
      }
      esRef.current = null;
    }
    setConnected(false);
  }, []);

  const connect = useCallback(() => {
    const token = localStorage.getItem("token");
    if (!token || typeof window === "undefined" || !window.EventSource) {
      setConnected(false);
      return;
    }

    stoppedRef.current = false;
    if (esRef.current) {
      try {
        esRef.current.close();
      } catch {
        /* ignore */
      }
      esRef.current = null;
    }

    const es = new EventSource(buildEventsUrl(token));
    esRef.current = es;

    es.addEventListener("attendance.updated", (msg) => {
      try {
        const data = JSON.parse(msg.data);
        backoffRef.current = 1000;
        dispatchLocal(data);
      } catch (err) {
        console.warn("attendance SSE parse error", err);
      }
    });

    es.onopen = () => {
      setConnected(true);
      backoffRef.current = 1000;
    };

    es.onerror = () => {
      setConnected(false);
      try {
        es.close();
      } catch {
        /* ignore */
      }
      if (esRef.current === es) esRef.current = null;
      if (stoppedRef.current) return;
      const delay = Math.min(backoffRef.current, 30000);
      backoffRef.current = Math.min(delay * 2, 30000);
      reconnectTimerRef.current = window.setTimeout(() => {
        if (!stoppedRef.current) connect();
      }, delay);
    };
  }, [dispatchLocal]);

  useEffect(() => {
    connect();
    const onStorage = (e) => {
      if (e.key === "token") {
        disconnect();
        if (e.newValue) {
          stoppedRef.current = false;
          connect();
        }
      }
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("storage", onStorage);
      disconnect();
    };
  }, [connect, disconnect]);

  const value = useMemo(
    () => ({
      connected,
      lastEvent,
      reconnect: () => {
        disconnect();
        stoppedRef.current = false;
        backoffRef.current = 1000;
        connect();
      },
    }),
    [connected, lastEvent, connect, disconnect]
  );

  return (
    <AttendanceEventsContext.Provider value={value}>
      {children}
    </AttendanceEventsContext.Provider>
  );
}

export function useAttendanceEvents() {
  return useContext(AttendanceEventsContext) || {
    connected: false,
    lastEvent: null,
    reconnect: () => {},
  };
}

/** Subscribe to attendance.updated without requiring the provider context. */
export function useAttendanceUpdatedListener(handler) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  useEffect(() => {
    const onEvt = (e) => {
      const fn = handlerRef.current;
      if (typeof fn === "function") fn(e.detail);
    };
    window.addEventListener(ATTENDANCE_UPDATED_EVENT, onEvt);
    return () => window.removeEventListener(ATTENDANCE_UPDATED_EVENT, onEvt);
  }, []);
}
