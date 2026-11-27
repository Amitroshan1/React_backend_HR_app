import { useEffect, useRef } from "react";
import { useNetworkOnline } from "../../hooks/useNetworkOnline";
import { NO_INTERNET_MESSAGE } from "../../utils/networkStatus";
import { useUser } from "./UserContext";
import "./OfflineBanner.css";

export function OfflineBanner() {
  const online = useNetworkOnline();
  const { refreshUserData } = useUser();
  const wasOfflineRef = useRef(false);

  useEffect(() => {
    if (!online) {
      wasOfflineRef.current = true;
      return;
    }
    if (!wasOfflineRef.current) return;
    wasOfflineRef.current = false;
    if (typeof refreshUserData === "function") {
      refreshUserData({ force: true });
    }
  }, [online, refreshUserData]);

  if (online) return null;

  return (
    <div className="offline-banner" role="status" aria-live="polite">
      {NO_INTERNET_MESSAGE}
    </div>
  );
}
