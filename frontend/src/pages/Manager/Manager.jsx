import { useState, useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { LeaveRequests } from "./comps/LeaveRequests/LeaveRequests";
import { ClaimRequests } from "./comps/LeaveRequests/ClaimRequests";
import { WFHRequests } from "./comps/LeaveRequests/WFHRequests";
import { ResignationRequests } from "./comps/LeaveRequests/ResignationRequests";
import { TeamOffboarding } from "./comps/TeamOffboarding/TeamOffboarding";
import { NocRequests } from "./comps/LeaveRequests/NocRequests";
import { ManagerPerformanceReviews } from "./ManagerPerformanceReviews";
import { ManagerProbationReviews } from "./ManagerProbationReviews";
import { ManagerIncrementProposals } from "./ManagerIncrementProposals";
import { ManagerTeamAttendance } from "./ManagerTeamAttendance";
import { ManagerTeamLeaveApply } from "./ManagerTeamLeaveApply";
import { ManagerProfileCard } from "./comps/ManagerProfileCard/ManagerProfileCard";
import { fetchPendingCounts, fetchManagerProfile, fetchPendingPerformanceReviewsCount, fetchProbationReviewsDue } from "./api";
import { managerCanViewNhqEngineeringTeamAttendance } from "./managerTeamAttendanceEligibility";
import "./Manager.css";
import { usePersistedView } from "../../hooks/usePersistedView";
import { useRefreshOnNavigate } from "../../hooks/useRefreshOnNavigate";

const MANAGER_TABS = [
  "leave",
  "wfh",
  "claims",
  "resignation",
  "offboarding",
  "noc",
  "performance",
  "probation",
  "increment",
  "attendance",
];

const APPROVAL_TABS = [
  { key: "leave", label: "Leave", countKey: "leave" },
  { key: "wfh", label: "Work From Home", countKey: "wfh" },
  { key: "claims", label: "Claims", countKey: "claim" },
  { key: "resignation", label: "Resignation", countKey: "resignation" },
  { key: "offboarding", label: "Team Exit", countKey: "offboarding" },
  { key: "noc", label: "NOC Request", countKey: "noc" },
];
const PERFORMANCE_TAB = { key: "performance", label: "Performance", countKey: "performance" };
const PROBATION_TAB = { key: "probation", label: "Probation", countKey: "probation" };
const INCREMENT_TAB = { key: "increment", label: "Increment", countKey: "increment" };
const ATTENDANCE_TAB = { key: "attendance", label: "Attendance", countKey: "attendance" };

export const Manager = () => {
  const location = useLocation();
  const [activeTab, setActiveTab] = usePersistedView({
    storageKey: "manager_active_tab",
    defaultView: "leave",
    validViews: MANAGER_TABS,
    syncUrl: false,
  });
  const [statusFilter, setStatusFilter] = useState("All");
  const [updateSignal, setUpdateSignal] = useState(null);
  const [counts, setCounts] = useState({
    leave: 0,
    wfh: 0,
    claim: 0,
    resignation: 0,
    noc: 0,
  });
  const [pendingPerformanceCount, setPendingPerformanceCount] = useState(0);
  const [probationCount, setProbationCount] = useState(0);
  const [managerProfile, setManagerProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [countsLoaded, setCountsLoaded] = useState(false);
  const [performanceCountLoaded, setPerformanceCountLoaded] = useState(false);
  const [probationCountLoaded, setProbationCountLoaded] = useState(false);
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

  useRefreshOnNavigate(() => {
    reloadCounts();
  }, [activeTab]);

  useRefreshOnNavigate(() => {
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

  const showTeamAttendance =
    !profileLoading && managerCanViewNhqEngineeringTeamAttendance(managerProfile?.scope);

  useEffect(() => {
    if (!showTeamAttendance && activeTab === ATTENDANCE_TAB.key) {
      setActiveTab("leave");
    }
  }, [showTeamAttendance, activeTab]);

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
    let isMounted = true;
    const loadProbation = async () => {
      try {
        const list = await fetchProbationReviewsDue();
        if (isMounted) setProbationCount(Array.isArray(list) ? list.length : 0);
      } catch {
        if (isMounted) setProbationCount(0);
      } finally {
        if (isMounted) setProbationCountLoaded(true);
      }
    };
    loadProbation();
    return () => { isMounted = false; };
  }, []);

  useEffect(() => {
    if (!countsLoaded || !performanceCountLoaded || !probationCountLoaded || defaultTabApplied.current) return;
    defaultTabApplied.current = true;
    try {
      const saved = localStorage.getItem("manager_active_tab");
      if (saved && MANAGER_TABS.includes(saved)) return;
    } catch {
      /* ignore */
    }
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
    if ((counts.noc || 0) > 0) {
      setActiveTab("noc");
      return;
    }
    if ((pendingPerformanceCount || 0) > 0) {
      setActiveTab("performance");
      return;
    }
    if ((probationCount || 0) > 0) {
      setActiveTab("probation");
    }
  }, [countsLoaded, performanceCountLoaded, probationCountLoaded, counts.leave, counts.wfh, counts.claim, counts.resignation, counts.noc, pendingPerformanceCount, probationCount]);

  const getCount = (countKey) => {
    if (countKey === "performance") return pendingPerformanceCount;
    if (countKey === "probation") return probationCount;
    if (countKey === "attendance") return 0;
    return counts[countKey] ?? 0;
  };

  const isApprovalTab = APPROVAL_TABS.some((t) => t.key === activeTab);
  const showStatusFilters = isApprovalTab && activeTab !== 'offboarding';

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
      case "offboarding":
        return <TeamOffboarding />;
      case "noc":
        return <NocRequests {...panelProps} />;
      case "performance":
        return <ManagerPerformanceReviews />;
      case "probation":
        return <ManagerProbationReviews />;
      case "increment":
        return <ManagerIncrementProposals />;
      case "attendance":
        return <ManagerTeamAttendance scope={managerProfile?.scope} />;
      case "leave":
      default:
        return (
          <>
            <ManagerTeamLeaveApply />
            <LeaveRequests {...panelProps} />
          </>
        );
    }
  };

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
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === PROBATION_TAB.key}
          className={`manager-tab ${activeTab === PROBATION_TAB.key ? "active" : ""}`}
          onClick={() => setActiveTab(PROBATION_TAB.key)}
        >
          {PROBATION_TAB.label}
          <span
            className={`manager-tab-badge ${getCount(PROBATION_TAB.countKey) > 0 ? "has-pending" : ""}`}
            aria-label={`${getCount(PROBATION_TAB.countKey)} probation reviews due`}
          >
            {getCount(PROBATION_TAB.countKey)}
          </span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === INCREMENT_TAB.key}
          className={`manager-tab ${activeTab === INCREMENT_TAB.key ? "active" : ""}`}
          onClick={() => setActiveTab(INCREMENT_TAB.key)}
        >
          {INCREMENT_TAB.label}
          <span className="manager-tab-badge" aria-label="Increment proposals">0</span>
        </button>
        {showTeamAttendance && (
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === ATTENDANCE_TAB.key}
            className={`manager-tab ${activeTab === ATTENDANCE_TAB.key ? "active" : ""}`}
            onClick={() => setActiveTab(ATTENDANCE_TAB.key)}
          >
            {ATTENDANCE_TAB.label}
            <span
              className="manager-tab-badge"
              aria-label="Team attendance"
            >
              {getCount(ATTENDANCE_TAB.countKey)}
            </span>
          </button>
        )}
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
