const API_BASE = "/api/manager";

function authHeaders() {
  const token = localStorage.getItem("token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Parse JSON from a fetch Response; fail clearly when the server returns HTML (e.g. SPA index or error page). */
async function parseApiJson(response) {
  const text = await response.text();
  const trimmed = text.trim();
  if (!trimmed) {
    return {};
  }
  if (trimmed.startsWith("<")) {
    const hint =
      response.status === 404
        ? "API not found (404). Ensure the backend is running and /api is proxied to Flask."
        : `Server returned a web page instead of JSON (${response.status}). Check login and backend logs.`;
    throw new Error(hint);
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    throw new Error(`Invalid response from server (${response.status}). Expected JSON.`);
  }
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
  noc: {
    list: "/noc-requests",
  },
};

export async function fetchDepartmentNocRequests(apiBase = API_BASE, statusFilter = "Pending") {
  let st = statusFilter || "Pending";
  if (st === "Approved") st = "Uploaded";
  const params = new URLSearchParams();
  params.set("status", st);

  const response = await fetch(`${apiBase}/noc-requests?${params.toString()}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      ...authHeaders(),
    },
  });

  const result = await parseApiJson(response);
  if (!response.ok || !result.success) {
    throw new Error(result.message || "Failed to load requests");
  }
  return result.requests || [];
}

export async function fetchTeamOffboarding() {
  const response = await fetch(`${API_BASE}/team-offboarding`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      ...authHeaders(),
    },
  });
  const result = await parseApiJson(response);
  if (!response.ok || !result.success) {
    throw new Error(result.message || "Failed to load team offboarding");
  }
  return result.members || [];
}

export async function fetchManagerRequests(type, statusFilter = "Pending") {
  const config = endpointMap[type];
  if (!config) throw new Error(`Unsupported manager request type: ${type}`);

  if (type === "noc") {
    return fetchDepartmentNocRequests(API_BASE, statusFilter);
  }

  const params = new URLSearchParams();
  let st = statusFilter || "Pending";
  params.set("status", st);

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
  if (!config || typeof config.action !== "function") {
    throw new Error(`Unsupported manager request type: ${type}`);
  }

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

export async function uploadNocDepartmentRequest(requestId, file, apiBase = API_BASE) {
  const token = localStorage.getItem("token");
  const formData = new FormData();
  formData.append("file", file);
  const response = await fetch(`${apiBase}/noc-requests/${requestId}/upload`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}`, Accept: "application/json" } : { Accept: "application/json" },
    body: formData,
  });
  const result = await parseApiJson(response);
  if (!response.ok || !result.success) {
    throw new Error(result.message || "Failed to upload NOC document");
  }
  return result;
}

export async function fetchPendingCounts() {
  const [leave, wfh, claim, resignation, noc] = await Promise.all([
    fetchManagerRequests("leave", "Pending"),
    fetchManagerRequests("wfh", "Pending"),
    fetchManagerRequests("claim", "Pending"),
    fetchManagerRequests("resignation", "Pending"),
    fetchManagerRequests("noc", "Pending"),
  ]);

  return {
    leave: leave.length,
    wfh: wfh.length,
    claim: claim.length,
    resignation: resignation.length,
    noc: noc.length,
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

export async function fetchManagerTeamAttendance(month, year) {
  const params = new URLSearchParams();
  params.set("month", String(month));
  params.set("year", String(year));
  const response = await fetch(`${API_BASE}/team-attendance?${params.toString()}`, {
    method: "GET",
    headers: {
      ...authHeaders(),
    },
  });
  const result = await response.json();
  if (!response.ok || !result.success) {
    throw new Error(result.message || "Failed to load team attendance");
  }
  return result.rows || [];
}

export async function fetchManagerPerformanceQueue(filters = {}) {
  const params = new URLSearchParams();
  const month = String(filters.month || "").trim();
  const status = String(filters.status || "").trim();
  if (month) params.set("month", month);
  if (status && status.toLowerCase() !== "all") params.set("status", status);

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

export async function fetchManagerProbationReviews({ status = "all" } = {}) {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  const response = await fetch(`${API_BASE}/probation-reviews?${params.toString()}`, {
    method: "GET",
    headers: authHeaders(),
  });
  const result = await response.json();
  if (!response.ok || !result.success) {
    throw new Error(result.message || "Failed to load probation reviews");
  }
  return {
    reviews: result.reviews || [],
    summary: result.summary || {},
  };
}

export async function fetchManagerClaimById(claimId) {
  const response = await fetch(`${API_BASE}/claim-requests/${claimId}`, {
    method: "GET",
    headers: authHeaders(),
  });
  const result = await parseApiJson(response);
  if (!response.ok || !result.success) {
    throw new Error(result.message || "Failed to load claim details");
  }
  return result.claim;
}

export function managerClaimFileUrl(claimId, lineItemId) {
  return `${API_BASE}/claim-requests/${claimId}/files/${lineItemId}`;
}

export async function fetchManagerClaimFileBlob(claimId, lineItemId) {
  const response = await fetch(managerClaimFileUrl(claimId, lineItemId), {
    method: "GET",
    headers: authHeaders(),
  });
  if (!response.ok) {
    let msg = "Unable to open file";
    try {
      const j = await response.json();
      msg = j?.message || msg;
    } catch {
      // ignore
    }
    throw new Error(msg);
  }
  return response.blob();
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

export async function submitIncrementProposal(payload) {
  const response = await fetch(`${API_BASE}/increment-proposals`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify(payload),
  });
  const result = await parseApiJson(response);
  if (!response.ok || !result.success) {
    throw new Error(result.message || "Failed to submit increment proposal");
  }
  return result;
}

export async function fetchCompensationBandHint(adminId) {
  const response = await fetch(`${API_BASE}/compensation-band-hint?admin_id=${encodeURIComponent(adminId)}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      ...authHeaders(),
    },
  });
  const result = await parseApiJson(response);
  if (!response.ok || !result.success) {
    throw new Error(result.message || "Failed to load band hint");
  }
  return result;
}
