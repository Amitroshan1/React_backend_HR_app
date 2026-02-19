import { useState, useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { LeaveRequests } from "./comps/LeaveRequests/LeaveRequests";
import { ClaimRequests } from "./comps/LeaveRequests/ClaimRequests";
import { WFHRequests } from "./comps/LeaveRequests/WFHRequests";
import { ResignationRequests } from "./comps/LeaveRequests/ResignationRequests";
import { ManagerPerformanceReviews } from "./ManagerPerformanceReviews";
import { ManagerProfileCard } from "./comps/ManagerProfileCard/ManagerProfileCard";
import { fetchPendingCounts, fetchManagerProfile, fetchPendingPerformanceReviewsCount } from "./api";
import "./Manager.css";

const APPROVAL_TABS = [
  { key: "leave", label: "Leave", countKey: "leave" },
  { key: "wfh", label: "Work From Home", countKey: "wfh" },
  { key: "claims", label: "Claims", countKey: "claim" },
  { key: "resignation", label: "Resignation", countKey: "resignation" },
];
const PERFORMANCE_TAB = { key: "performance", label: "Performance", countKey: "performance" };

export const Manager = () => {
  const location = useLocation();
  const [activeTab, setActiveTab] = useState("leave");
  const [statusFilter, setStatusFilter] = useState("All");
  const [updateSignal, setUpdateSignal] = useState(null);
  const [counts, setCounts] = useState({
    leave: 0,
    wfh: 0,
    claim: 0,
    resignation: 0,
  });
  const [pendingPerformanceCount, setPendingPerformanceCount] = useState(0);
  const [managerProfile, setManagerProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [countsLoaded, setCountsLoaded] = useState(false);
  const [performanceCountLoaded, setPerformanceCountLoaded] = useState(false);
  const defaultTabApplied = useRef(false);

  const reloadCounts = async () => {
    try {
      const pending = await fetchPendingCounts();
      setCounts(pending);
      setCountsLoaded(true);
    } catch (error) {
      console.error("Manager counts load error:", error);
      setCountsLoaded(true);
    }
  };

  useEffect(() => {
    if (location.state?.updatedId && location.state?.newStatus) {
      setUpdateSignal({
        id: location.state.updatedId,
        status: location.state.newStatus,
      });
    }
  }, [location.state]);

  useEffect(() => {
    reloadCounts();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const profile = await fetchManagerProfile();
        setManagerProfile(profile);
      } catch (error) {
        console.error("Manager profile error:", error);
      } finally {
        setProfileLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    let isMounted = true;
    let timerId = null;
    const load = async () => {
      try {
        const count = await fetchPendingPerformanceReviewsCount();
        if (isMounted) {
          setPendingPerformanceCount(count);
          setPerformanceCountLoaded(true);
        }
      } catch (error) {
        console.error("Pending performance count error:", error);
        if (isMounted) setPerformanceCountLoaded(true);
      }
    };
    load();
    timerId = window.setInterval(load, 30000);
    return () => {
      isMounted = false;
      if (timerId) window.clearInterval(timerId);
    };
  }, []);

  useEffect(() => {
    if (!countsLoaded || !performanceCountLoaded || defaultTabApplied.current) return;
    defaultTabApplied.current = true;
    if ((counts.leave || 0) > 0) {
      setActiveTab("leave");
      return;
    }
    if ((counts.wfh || 0) > 0) {
      setActiveTab("wfh");
      return;
    }
    if ((counts.claim || 0) > 0) {
      setActiveTab("claims");
      return;
    }
    if ((counts.resignation || 0) > 0) {
      setActiveTab("resignation");
      return;
    }
    if ((pendingPerformanceCount || 0) > 0) {
      setActiveTab("performance");
    }
  }, [countsLoaded, performanceCountLoaded, counts.leave, counts.wfh, counts.claim, counts.resignation, pendingPerformanceCount]);

  const getCount = (countKey) => {
    if (countKey === "performance") return pendingPerformanceCount;
    return counts[countKey] ?? 0;
  };

  const isApprovalTab = APPROVAL_TABS.some((t) => t.key === activeTab);

  const renderTabContent = () => {
    const panelProps = {
      updateSignal,
      statusFilter: statusFilter,
      onRequestUpdated: reloadCounts,
    };
    switch (activeTab) {
      case "claims":
      case "claim":
        return <ClaimRequests {...panelProps} />;
      case "wfh":
        return <WFHRequests {...panelProps} />;
      case "resignation":
        return <ResignationRequests {...panelProps} />;
      case "performance":
        return <ManagerPerformanceReviews />;
      default:
        return <LeaveRequests {...panelProps} />;
    }
  };

  const showStatusFilters = isApprovalTab;

  return (
    <div className="manager-dashboard-wrapper">
      <ManagerProfileCard profile={managerProfile} loading={profileLoading} />

      <div className="manager-tabs-wrap" role="tablist">
        {APPROVAL_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.key}
            className={`manager-tab ${activeTab === tab.key ? "active" : ""}`}
            onClick={() => {
              setActiveTab(tab.key);
              setStatusFilter("All");
            }}
          >
            {tab.label}
            <span
              className={`manager-tab-badge ${getCount(tab.countKey) > 0 ? "has-pending" : ""}`}
              aria-label={`${getCount(tab.countKey)} pending`}
            >
              {getCount(tab.countKey)}
            </span>
          </button>
        ))}
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === PERFORMANCE_TAB.key}
          className={`manager-tab ${activeTab === PERFORMANCE_TAB.key ? "active" : ""}`}
          onClick={() => setActiveTab(PERFORMANCE_TAB.key)}
        >
          {PERFORMANCE_TAB.label}
          <span
            className={`manager-tab-badge ${getCount(PERFORMANCE_TAB.countKey) > 0 ? "has-pending" : ""}`}
            aria-label={`${getCount(PERFORMANCE_TAB.countKey)} pending reviews`}
          >
            {getCount(PERFORMANCE_TAB.countKey)}
          </span>
        </button>
      </div>

      {showStatusFilters && (
        <div className="manager-status-filters">
          {["All", "Pending", "Approved", "Rejected"].map((status) => (
            <button
              key={status}
              type="button"
              className={statusFilter === status ? "active" : ""}
              onClick={() => setStatusFilter(status)}
            >
              {status}
            </button>
          ))}
        </div>
      )}

      <div className="manager-tab-content" role="tabpanel">
        {renderTabContent()}
      </div>
    </div>
  );
};
