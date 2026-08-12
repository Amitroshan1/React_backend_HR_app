import { fetchAndOpenAuthenticatedFile, openOrDownloadBlob } from "../../utils/openBlobFile";

export const QUERY_CHAT_POLL_MS = 4000;
export const QUERY_INBOX_POLL_MS = 30000;
export const QUERY_CHAT_PARAM = 'chat';

const normDept = (value) => String(value ?? '').trim().toLowerCase();

/** Canonical department for inbox scoping (matches Queries.jsx / backend plan_features). */
export const canonicalQueryDepartment = (name) => {
  const n = normDept(name);
  if (!n) return null;
  if (
    n === 'human resource' ||
    n === 'human resources' ||
    n === 'hr' ||
    n.includes('human resource')
  ) {
    return 'Human Resource';
  }
  if (n === 'it' || n === 'it department' || n === 'engineering' || n === 'inventory') {
    return 'IT';
  }
  if (
    n === 'account' ||
    n === 'accounts' ||
    n === 'accountant' ||
    n.startsWith('account') ||
    n.includes('accounts')
  ) {
    return 'Accounts';
  }
  return null;
};

export const queryBelongsToItInbox = (department) =>
  canonicalQueryDepartment(department) === 'IT';

export const filterQueriesForItInbox = (queries) =>
  (queries || []).filter((q) => queryBelongsToItInbox(q?.department));

export const parseChatIdFromSearch = (search) => {
  const raw = new URLSearchParams(search || '').get(QUERY_CHAT_PARAM);
  if (!raw) return null;
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : null;
};

export const mapChatMessages = (chatMessages, queryId, formatDateTime) =>
  (chatMessages || []).map((message, idx) => ({
    id: `${queryId}-${idx}-${message.created_at || idx}`,
    sender: message.user_type === 'EMPLOYEE' ? 'user' : 'department',
    senderName: message.by || 'User',
    text: message.text,
    timestamp: formatDateTime(message.created_at),
  }));

export const messagesChanged = (prevMessages, nextMessages) => {
  if (!prevMessages && !nextMessages) return false;
  if (!prevMessages || !nextMessages) return true;
  if (prevMessages.length !== nextMessages.length) return true;
  const prevLast = prevMessages[prevMessages.length - 1];
  const nextLast = nextMessages[nextMessages.length - 1];
  return (
    prevLast?.text !== nextLast?.text ||
    prevLast?.timestamp !== nextLast?.timestamp ||
    prevLast?.senderName !== nextLast?.senderName
  );
};

export const queryAttachmentDisplayName = (storedName) => {
  const name = String(storedName || '').trim();
  if (!name) return 'Attachment';
  const idx = name.indexOf('_');
  if (idx >= 0 && idx < name.length - 1) {
    return name.slice(idx + 1);
  }
  return name;
};

export const buildQueryAttachmentUrl = (apiBase, queryId, storedName) =>
  `${apiBase}/queries/${queryId}/files/${encodeURIComponent(storedName)}`;

export { openOrDownloadBlob };

/**
 * Fetch an authenticated query attachment and open/download it.
 */
export async function openQueryAttachmentFile(apiBase, queryId, storedName, { token } = {}) {
  if (!queryId || !storedName) {
    throw new Error("Invalid attachment");
  }
  await fetchAndOpenAuthenticatedFile(
    buildQueryAttachmentUrl(apiBase, queryId, storedName),
    { token, fileName: storedName },
  );
}

/** Parse fetch responses safely (handles empty bodies and non-JSON). */
export async function readApiResponse(response) {
  const text = await response.text();
  const trimmed = text.trim();

  if (!trimmed) {
    if (!response.ok) {
      return {
        ok: false,
        data: {},
        error: `Request failed (${response.status})`,
      };
    }
    return {
      ok: false,
      data: {},
      error: 'Server returned an empty response. Please refresh or try again.',
    };
  }

  try {
    const data = JSON.parse(trimmed);
    if (!response.ok) {
      return {
        ok: false,
        data,
        error: data.message || `Request failed (${response.status})`,
      };
    }
    return { ok: true, data, error: null };
  } catch {
    return {
      ok: false,
      data: {},
      error: 'Invalid response from server',
    };
  }
}

/** Same raise to multiple departments creates separate tickets — group them for employee history. */
const MULTI_DEPT_GROUP_WINDOW_MS = 15000;

const attachmentKey = (attachments) =>
  (Array.isArray(attachments) ? attachments : []).slice().sort().join('|');

export function shortDepartmentLabel(department) {
  const canon = canonicalQueryDepartment(department);
  if (canon === 'Human Resource') return 'HR';
  if (canon === 'Accounts') return 'Accounts';
  if (canon === 'IT') return 'IT';
  const raw = String(department || '').trim();
  return raw || '—';
}

/**
 * Group employee "my queries" that were raised together (same title/text/files, close timestamps).
 * Department inboxes stay one-row-per-ticket; only history UI uses groups.
 */
export function groupMyQueriesForHistory(queries, windowMs = MULTI_DEPT_GROUP_WINDOW_MS) {
  const list = Array.isArray(queries) ? queries : [];
  const sorted = [...list].sort((a, b) => {
    const tb = new Date(b.createdAtRaw || 0).getTime();
    const ta = new Date(a.createdAtRaw || 0).getTime();
    return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0);
  });

  const used = new Set();
  const groups = [];

  for (const q of sorted) {
    if (used.has(q.id)) continue;
    const members = [q];
    used.add(q.id);
    const t0 = new Date(q.createdAtRaw || 0).getTime();
    const att0 = attachmentKey(q.attachments);
    const title0 = String(q.title || '').trim();
    const text0 = String(q.queryText || '').trim();

    for (const other of sorted) {
      if (used.has(other.id)) continue;
      if (String(other.title || '').trim() !== title0) continue;
      if (String(other.queryText || '').trim() !== text0) continue;
      if (attachmentKey(other.attachments) !== att0) continue;
      const t1 = new Date(other.createdAtRaw || 0).getTime();
      if (!Number.isFinite(t0) || !Number.isFinite(t1)) continue;
      if (Math.abs(t1 - t0) > windowMs) continue;
      members.push(other);
      used.add(other.id);
    }

    members.sort((a, b) =>
      String(a.department || '').localeCompare(String(b.department || ''), undefined, {
        sensitivity: 'base',
      })
    );

    const newest = members.reduce((best, m) => {
      const tb = new Date(best.createdAtRaw || 0).getTime();
      const tm = new Date(m.createdAtRaw || 0).getTime();
      return tm >= tb ? m : best;
    }, members[0]);

    groups.push({
      groupKey: members.map((m) => m.id).join('-'),
      title: newest.title,
      queryText: newest.queryText,
      attachments: newest.attachments || [],
      createdAt: newest.createdAt,
      createdAtRaw: newest.createdAtRaw,
      members,
      hasUnreadReply: members.some((m) => m.hasUnreadReply),
      unreadReplyCount: members.reduce((sum, m) => sum + Number(m.unreadReplyCount || 0), 0),
      openMembers: members.filter((m) => String(m.status || '').toLowerCase() !== 'closed'),
    });
  }

  return groups;
}
