export const QUERY_CHAT_POLL_MS = 4000;
export const QUERY_INBOX_POLL_MS = 30000;
export const QUERY_CHAT_PARAM = 'chat';

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
