import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { FiSun, FiStar, FiRefreshCw, FiPlus } from 'react-icons/fi';
import { ApplyLeaveModal } from './ApplyLeaveModal';
import './Leaves.css';
import { useUser } from '../../components/layout/UserContext';
import { useRefreshOnNavigate } from '../../hooks/useRefreshOnNavigate';
import { formatDate } from '../../utils/dateFormat';

const API_BASE_URL = "/api/leave";
const RECENT_HISTORY_LIMIT = 10;

const MONTH_OPTIONS = [
    { value: 1, label: "January" },
    { value: 2, label: "February" },
    { value: 3, label: "March" },
    { value: 4, label: "April" },
    { value: 5, label: "May" },
    { value: 6, label: "June" },
    { value: 7, label: "July" },
    { value: 8, label: "August" },
    { value: 9, label: "September" },
    { value: 10, label: "October" },
    { value: 11, label: "November" },
    { value: 12, label: "December" },
];

const formatLeaveDays = (value) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return "—";
    return Number.isInteger(n) ? String(n) : n.toFixed(1);
};

const padMonth = (month) => String(month).padStart(2, "0");

const monthBounds = (year, month) => {
    const lastDay = new Date(year, month, 0).getDate();
    return {
        start: `${year}-${padMonth(month)}-01`,
        end: `${year}-${padMonth(month)}-${String(lastDay).padStart(2, "0")}`,
    };
};

const leaveOverlapsRange = (request, rangeStart, rangeEnd) => {
    if (!request?.from || !request?.to) return false;
    return request.from <= rangeEnd && request.to >= rangeStart;
};

const leaveMatchesFilter = (request, filterYear, filterMonth) => {
    if (!filterYear) return true;
    if (filterMonth) {
        const { start, end } = monthBounds(filterYear, filterMonth);
        return leaveOverlapsRange(request, start, end);
    }
    return leaveOverlapsRange(request, `${filterYear}-01-01`, `${filterYear}-12-31`);
};

export const Leaves= () => {
    const { userData, refreshUserData } = useUser();
    const [requests, setRequests] = useState([]);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [loadingRequests, setLoadingRequests] = useState(true);
    const [filterYear, setFilterYear] = useState("");
    const [filterMonth, setFilterMonth] = useState("");
    const [cancellingId, setCancellingId] = useState(null);

    const isFilterActive = Boolean(filterYear);

    const yearOptions = useMemo(() => {
        const currentYear = new Date().getFullYear();
        const yearsFromData = requests.flatMap((req) => {
            const fromYear = req.from ? Number(req.from.slice(0, 4)) : NaN;
            const toYear = req.to ? Number(req.to.slice(0, 4)) : NaN;
            return [fromYear, toYear].filter((y) => Number.isFinite(y));
        });
        const minYear = yearsFromData.length
            ? Math.min(...yearsFromData, currentYear)
            : currentYear;
        const options = [];
        for (let y = currentYear; y >= minYear; y -= 1) {
            options.push(y);
        }
        return options;
    }, [requests]);

    const filteredRequests = useMemo(() => {
        if (!isFilterActive) return requests;
        return requests.filter((req) => leaveMatchesFilter(req, Number(filterYear), filterMonth ? Number(filterMonth) : null));
    }, [requests, isFilterActive, filterYear, filterMonth]);

    const visibleRequests = useMemo(() => {
        if (!isFilterActive) return requests.slice(0, RECENT_HISTORY_LIMIT);
        return filteredRequests;
    }, [requests, isFilterActive, filteredRequests]);

    const historySummary = useMemo(() => {
        const total = requests.length;
        if (!total) return "";

        if (!isFilterActive) {
            const shown = Math.min(total, RECENT_HISTORY_LIMIT);
            if (total <= RECENT_HISTORY_LIMIT) {
                return `Showing all ${total} request${total === 1 ? "" : "s"}.`;
            }
            return `Showing ${shown} most recent of ${total} total. Use month/year filters to view older requests.`;
        }

        const monthLabel = filterMonth
            ? MONTH_OPTIONS.find((m) => m.value === Number(filterMonth))?.label
            : null;
        const periodLabel = monthLabel
            ? `${monthLabel} ${filterYear}`
            : String(filterYear);

        if (!filteredRequests.length) {
            return `No leave requests in ${periodLabel}.`;
        }
        return `Showing ${filteredRequests.length} request${filteredRequests.length === 1 ? "" : "s"} for ${periodLabel} (${total} total).`;
    }, [requests.length, isFilterActive, filterYear, filterMonth, filteredRequests.length]);

    const handleFilterYearChange = (value) => {
        setFilterYear(value);
        if (!value) setFilterMonth("");
    };

    const clearHistoryFilters = () => {
        setFilterYear("");
        setFilterMonth("");
    };

    // Dynamic Calculation of Balances based on backend leave_balance
    const stats = useMemo(() => {
        const lb = userData.leave_balance || {};

        // Remaining/Pending balances from backend (what's left to use)
        const remainingPl = Number(lb.pl ?? 0);
        const remainingCl = Number(lb.cl ?? 0);
        const remainingComp = Number(lb.comp ?? 0);

        // Total entitlements from backend (fixed totals - e.g., CL=8, PL=13)
        const totalPl = Number(lb.total_pl ?? 0);
        const totalCl = Number(lb.total_cl ?? 0);
        const totalComp = Number(lb.total_comp ?? 0);

        // Used values from backend (how much has been used from total)
        const usedCasual = Number(lb.used_cl ?? 0);
        const usedPrivilege = Number(lb.used_pl ?? 0);
        const usedComp = Number(lb.used_comp ?? 0);

        return [
            { 
                type: 'Casual Leave', 
                value: remainingCl,  // Big number: Show remaining/pending (e.g., 5)
                subtext: `Total ${totalCl}, Used ${usedCasual}`,  // Subtext: Total entitlement (8) and how much used
                icon: <FiSun size={22} />, 
                colorClass: 'green-card'
            },
            { 
                type: 'Privilege Leave', 
                value: remainingPl,  // Big number: Show remaining/pending (e.g., 11)
                subtext: `Total ${totalPl}, Used ${usedPrivilege}`,  // Subtext: Total entitlement (13) and how much used
                icon: <FiStar size={22} />, 
                colorClass: 'blue-card'
            },
            {
                type: 'Compensatory Leave',
                value: remainingComp,  // Big number: Show remaining/pending
                subtext: `Total ${totalComp}, Used ${usedComp}`,  // Subtext: Total entitlement and how much used
                icon: <FiRefreshCw size={22} />,
                colorClass: 'orange-card'
            }
        ];
    }, [userData.leave_balance]);

    // Fetch leave requests from backend
    const fetchLeaveRequests = async () => {
        const token = localStorage.getItem('token');
        if (!token) {
            setLoadingRequests(false);
            return;
        }

        try {
            const response = await fetch(`${API_BASE_URL}/LeaveDetails`, {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error("API Error Response:", errorText);
                throw new Error(`Failed to fetch leave requests: ${response.status}`);
            }

            const result = await response.json();
            console.log("Leave Details API Response:", result); // Debug log

            if (result.success) {
                if (result.applications && Array.isArray(result.applications)) {
                    // Transform backend format to frontend format
                    const formattedRequests = result.applications.map(app => ({
                        id: app.id,
                        type: app.leave_type || 'Unknown',
                        from: app.start_date || '',
                        to: app.end_date || '',
                        paidDays: app.deducted_days ?? 0,
                        unpaidDays: app.extra_days ?? 0,
                        reason: app.reason || '',
                        status: app.status || 'Pending'
                    }));
                    console.log("Formatted Requests:", formattedRequests); // Debug log
                    setRequests(formattedRequests);
                } else {
                    console.warn("No applications array in response:", result);
                    setRequests([]);
                }
            } else {
                console.error("API returned success=false:", result.message);
                setRequests([]);
            }
        } catch (err) {
            console.error("Error fetching leave requests:", err);
            setRequests([]);
        } finally {
            setLoadingRequests(false);
        }
    };

    useRefreshOnNavigate(() => {
        fetchLeaveRequests();
    });

    useEffect(() => {
        const onLeaveDataChanged = () => {
            fetchLeaveRequests();
            refreshUserData();
        };
        window.addEventListener('leaveApplied', onLeaveDataChanged);
        window.addEventListener('leaveDataUpdated', onLeaveDataChanged);
        return () => {
            window.removeEventListener('leaveApplied', onLeaveDataChanged);
            window.removeEventListener('leaveDataUpdated', onLeaveDataChanged);
        };
    }, [refreshUserData]);

    const handleOpenApplyModal = useCallback(async () => {
        await Promise.all([fetchLeaveRequests(), refreshUserData()]);
        setIsModalOpen(true);
    }, [refreshUserData]);

    const handleCancelLeave = async (request) => {
        if (!request?.id || request.status !== "Pending") return;
        if (!window.confirm("Cancel this pending leave request?")) return;

        const token = localStorage.getItem("token");
        if (!token) {
            alert("Please log in again");
            return;
        }

        setCancellingId(request.id);
        try {
            const response = await fetch(`${API_BASE_URL}/requests/${request.id}/cancel`, {
                method: "POST",
                headers: { Authorization: `Bearer ${token}` },
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.success) {
                alert(result.message || "Failed to cancel leave request");
                return;
            }
            await fetchLeaveRequests();
            await refreshUserData();
            window.dispatchEvent(new CustomEvent("leaveDataUpdated"));
            alert("Leave request cancelled.");
        } catch (err) {
            console.error("Error cancelling leave:", err);
            alert("Failed to cancel leave request. Please try again.");
        } finally {
            setCancellingId(null);
        }
    };

    const handleLeaveSubmit = async (requestData) => {
        const token = localStorage.getItem('token');
        if (!token) {
            alert("Please login again");
            return false; // Return false to prevent modal from closing
        }

        try {
            // Map frontend leave types to backend format
            let backendLeaveType = requestData.leaveType;
            if (requestData.leaveType === 'Casual Leave' && requestData.calculatedDays === 0.5) {
                backendLeaveType = 'Half Day Leave';
            }
            // Optional Leave is now supported - no special mapping needed

            const requestPayload = {
                leave_type: backendLeaveType,
                start_date: requestData.fromDate,
                end_date: requestData.toDate,
                reason: requestData.reason
            };
            
            console.log("Submitting leave application:", requestPayload); // Debug log
            
            const response = await fetch(`${API_BASE_URL}/apply`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestPayload)
            });

            const result = await response.json();

            if (!response.ok) {
                alert(result.message || "Failed to apply leave");
                return false; // Return false to prevent modal from closing
            }

            if (result.success) {
                console.log("Leave applied successfully:", result); // Debug log
                // Refresh leave requests list and user data (to update balances)
                // Add small delay to ensure DB commit is complete
                await new Promise(resolve => setTimeout(resolve, 500));
                await fetchLeaveRequests();
                await refreshUserData();
                // Notify attendance page to refresh
                window.dispatchEvent(new CustomEvent('leaveApplied'));
                alert("Leave applied successfully!");
                return true; // Return true to allow modal to close
            } else {
                console.error("Leave application failed:", result); // Debug log
            }
            return false;
        } catch (err) {
            console.error("Error applying leave:", err);
            alert("Failed to apply leave. Please try again.");
            return false; // Return false to prevent modal from closing
        }
    };

    return (
        <div className="leave-dashboard-container">
            {/* <h1 className="page-title-leave">Leave Management</h1> */}

            <div className="summary-cards-grid-leave">
                {stats.map((item, index) => (
                    <div key={index} className={`summary-card-leave ${item.colorClass}`}>
                        <div className="summary-content-leave">
                            <p className="summary-value-leave">{item.value}</p> 
                            <p className="summary-label-leave">{item.type}</p>
                            <p className="summary-subtext-leave">{item.subtext}</p> 
                        </div>
                        <div className="summary-icon-leave">{item.icon}</div>
                    </div>
                ))}
            </div>

            <div className="leave-requests-card">
                <div className="requests-header-row">
                    <h2 className="section-title-leave">Leave Requests</h2>
                    <div className="requests-header-actions">
                        <div className="leave-history-filters" aria-label="Filter leave history">
                            <select
                                className="leave-history-filter-select"
                                value={filterYear}
                                onChange={(e) => handleFilterYearChange(e.target.value)}
                                aria-label="Filter by year"
                            >
                                <option value="">Recent</option>
                                {yearOptions.map((year) => (
                                    <option key={year} value={year}>{year}</option>
                                ))}
                            </select>
                            <select
                                className="leave-history-filter-select"
                                value={filterMonth}
                                onChange={(e) => setFilterMonth(e.target.value)}
                                disabled={!filterYear}
                                aria-label="Filter by month"
                            >
                                <option value="">All months</option>
                                {MONTH_OPTIONS.map((month) => (
                                    <option key={month.value} value={month.value}>{month.label}</option>
                                ))}
                            </select>
                            {isFilterActive && (
                                <button
                                    type="button"
                                    className="leave-history-filter-clear"
                                    onClick={clearHistoryFilters}
                                >
                                    Clear
                                </button>
                            )}
                        </div>
                        <button className="apply-leave-button" onClick={handleOpenApplyModal}>
                            <FiPlus /> Apply Leave
                        </button>
                    </div>
                </div>
                {!loadingRequests && historySummary && (
                    <p className="leave-history-summary">{historySummary}</p>
                )}
                <div className="leave-table-container">
                    {loadingRequests ? (
                        <p style={{ textAlign: 'center', padding: '20px' }}>Loading leave requests...</p>
                    ) : requests.length === 0 ? (
                        <p style={{ textAlign: 'center', padding: '20px', color: '#666' }}>
                            No leave requests found. Click "Apply Leave" to submit a new request.
                        </p>
                    ) : visibleRequests.length === 0 ? (
                        <p style={{ textAlign: 'center', padding: '20px', color: '#666' }}>
                            No leave requests match the selected period.
                        </p>
                    ) : (
                        <table className="leave-requests-table">
                            <thead>
                                <tr>
                                    <th>TYPE</th>
                                    <th>FROM</th>
                                    <th>TO</th>
                                    <th>PAID DAYS</th>
                                    <th>UNPAID LEAVE DAYS</th>
                                    <th>REASON</th>
                                    <th>STATUS</th>
                                    <th>ACTIONS</th>
                                </tr>
                            </thead>
                            <tbody>
                                {visibleRequests.map((request) => (
                                    <tr key={request.id}>
                                        <td>{request.type}</td>
                                        <td>{formatDate(request.from)}</td>
                                        <td>{formatDate(request.to)}</td>
                                        <td className="days-col paid-days-col">{formatLeaveDays(request.paidDays)}</td>
                                        <td className="days-col unpaid-days-col">{formatLeaveDays(request.unpaidDays)}</td>
                                        <td className="reason-col" title={request.reason}>
                                            {request.reason}
                                        </td>
                                        <td>
                                            <span className={`status-badge status-${request.status.toLowerCase()}`}>
                                                {request.status}
                                            </span>
                                        </td>
                                        <td className="leave-actions-col">
                                            {request.status === "Pending" ? (
                                                <button
                                                    type="button"
                                                    className="leave-cancel-btn"
                                                    onClick={() => handleCancelLeave(request)}
                                                    disabled={cancellingId === request.id}
                                                >
                                                    {cancellingId === request.id ? "Cancelling..." : "Cancel"}
                                                </button>
                                            ) : (
                                                "—"
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>
            
            <ApplyLeaveModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                onSubmit={handleLeaveSubmit}
                initialRequests={requests}
            />
        </div>
    );
};