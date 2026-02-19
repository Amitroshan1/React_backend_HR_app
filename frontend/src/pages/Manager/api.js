const API_BASE = "/api/manager";

function authHeaders() {
  const token = localStorage.getItem("token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

const endpointMap = {
  leave: {
    list: "/leave-requests",
    action: (id) => `/leave-requests/${id}/action`,
  },
  wfh: {
    list: "/wfh-requests",
    action: (id) => `/wfh-requests/${id}/action`,
  },
  claim: {
    list: "/claim-requests",
    action: (id) => `/claim-requests/${id}/action`,
  },
  resignation: {
    list: "/resignation-requests",
    action: (id) => `/resignation-requests/${id}/action`,
  },
};

export async function fetchManagerRequests(type, statusFilter = "Pending") {
  const config = endpointMap[type];
  if (!config) throw new Error(`Unsupported manager request type: ${type}`);

  const params = new URLSearchParams();
  params.set("status", statusFilter || "Pending");

  const response = await fetch(`${API_BASE}${config.list}?${params.toString()}`, {
    method: "GET",
    headers: {
      ...authHeaders(),
    },
  });

  const result = await response.json();
  if (!response.ok || !result.success) {
    throw new Error(result.message || "Failed to load requests");
  }
  return result.requests || [];
}

export async function actOnManagerRequest(type, id, action) {
  const config = endpointMap[type];
  if (!config) throw new Error(`Unsupported manager request type: ${type}`);

  const response = await fetch(`${API_BASE}${config.action(id)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify({ action }),
  });

  const result = await response.json();
  if (!response.ok || !result.success) {
    throw new Error(result.message || "Failed to update request");
  }
  return result;
}

export async function fetchPendingCounts() {
  const [leave, wfh, claim, resignation] = await Promise.all([
    fetchManagerRequests("leave", "Pending"),
    fetchManagerRequests("wfh", "Pending"),
    fetchManagerRequests("claim", "Pending"),
    fetchManagerRequests("resignation", "Pending"),
  ]);

  return {
    leave: leave.length,
    wfh: wfh.length,
    claim: claim.length,
    resignation: resignation.length,
  };
}

export async function fetchTeamMembers(filters = {}) {
  const params = new URLSearchParams();
  if (filters.circle && filters.circle !== "All") params.set("circle", filters.circle);
  if (filters.type && filters.type !== "All") params.set("emp_type", filters.type);

  const response = await fetch(`${API_BASE}/team-members?${params.toString()}`, {
    method: "GET",
    headers: {
      ...authHeaders(),
    },
  });

  const result = await response.json();
  if (!response.ok || !result.success) {
    throw new Error(result.message || "Failed to load team members");
  }
  return result;
}

export async function fetchSprintPerformance() {
  const response = await fetch(`/api/performance/manager/summary`, {
    method: "GET",
    headers: {
      ...authHeaders(),
    },
  });

  const result = await response.json();
  if (!response.ok || !result.success) {
    throw new Error(result.message || "Failed to load performance summary");
  }
  return result.items || [];
}

export async function fetchManagerScope() {
  const response = await fetch(`${API_BASE}/scope`, {
    method: "GET",
    headers: {
      ...authHeaders(),
    },
  });

  const result = await response.json();
  if (!response.ok || !result.success) {
    throw new Error(result.message || "Failed to load manager scope");
  }
  return result.scope || null;
}

export async function fetchManagerProfile() {
  const response = await fetch(`${API_BASE}/profile`, {
    method: "GET",
    headers: {
      ...authHeaders(),
    },
  });

  const result = await response.json();
  if (!response.ok || !result.success) {
    throw new Error(result.message || "Failed to load manager profile");
  }
  return result.profile || null;
}

export async function fetchManagerPerformanceQueue(filters = {}) {
  const params = new URLSearchParams();
  if (filters.month) params.set("month", filters.month);
  if (filters.status && filters.status !== "All") params.set("status", filters.status);

  const query = params.toString();
  const response = await fetch(
    `/api/performance/manager/queue${query ? `?${query}` : ""}`,
    {
      method: "GET",
      headers: {
        ...authHeaders(),
      },
    }
  );

  const result = await response.json();
  if (!response.ok || !result.success) {
    throw new Error(result.message || "Failed to load performance queue");
  }
  return result.items || [];
}

export async function submitManagerPerformanceReview(performanceId, payload) {
  const response = await fetch(`/api/performance/manager/review/${performanceId}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify(payload || {}),
  });

  const result = await response.json();
  if (!response.ok || !result.success) {
    throw new Error(result.message || "Failed to submit manager review");
  }
  return result.performance || null;
}

export async function fetchPendingPerformanceReviewsCount() {
  const items = await fetchManagerPerformanceQueue({ status: "Submitted" });
  return Array.isArray(items) ? items.length : 0;
}

export async function fetchProbationReviewsDue() {
  const response = await fetch(`${API_BASE}/probation-reviews-due`, {
    method: "GET",
    headers: authHeaders(),
  });
  const result = await response.json();
  if (!response.ok || !result.success) {
    throw new Error(result.message || "Failed to load probation reviews");
  }
  return result.reviews || [];
}

export async function submitProbationReview(probationReviewId, payload) {
  const response = await fetch(`${API_BASE}/probation-review`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify({ probation_review_id: probationReviewId, ...payload }),
  });
  const result = await response.json();
  if (!response.ok || !result.success) {
    throw new Error(result.message || "Failed to submit probation review");
  }
  return result;
}
