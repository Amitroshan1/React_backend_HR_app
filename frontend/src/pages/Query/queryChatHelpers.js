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
