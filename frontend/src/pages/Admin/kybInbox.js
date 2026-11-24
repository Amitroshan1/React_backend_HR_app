export const KYB_PACK_STATUSES = ['submitted', 'needs_fix', 'verified'];

const SEEN_KEY = 'hrms.admin.kybSeen.v1';

export function hasKybPack(customer) {
  return KYB_PACK_STATUSES.includes(String(customer?.kyc_status || '').toLowerCase());
}

export function kybFingerprint(customer) {
  return [
    customer?.id ?? '',
    customer?.kyc_status || '',
    customer?.kyb_revision ?? '',
    customer?.kyb_submitted_at || '',
  ].join('|');
}

export function loadKybSeen() {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function markKybSeen(customer) {
  if (!customer?.id) return;
  const seen = loadKybSeen();
  seen[String(customer.id)] = kybFingerprint(customer);
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
  } catch {
    /* ignore quota */
  }
}

export function isUnseenSubmittedKyb(customer, seen = loadKybSeen()) {
  if (String(customer?.kyc_status || '').toLowerCase() !== 'submitted') return false;
  return seen[String(customer.id)] !== kybFingerprint(customer);
}

export function unseenSubmittedKybCount(customers) {
  const seen = loadKybSeen();
  return (customers || []).filter((row) => isUnseenSubmittedKyb(row, seen)).length;
}

const STATUS_RANK = { submitted: 0, needs_fix: 1, verified: 2 };

export function sortKybInbox(customers) {
  return [...customers].sort((a, b) => {
    const ra = STATUS_RANK[a.kyc_status] ?? 9;
    const rb = STATUS_RANK[b.kyc_status] ?? 9;
    if (ra !== rb) return ra - rb;
    return String(a.company_name || '').localeCompare(String(b.company_name || ''));
  });
}
