/**
 * In-memory chat session store.
 *
 * Maps a client-provided sessionId to the Azure conversation id (Tier 1)
 * and a capped message history (Tier 2 fallback), so multi-turn chats keep
 * context instead of starting a new conversation on every request.
 * Sessions expire after a TTL and the store is size-capped (LRU eviction).
 */

export function createSessionStore({
  ttlMs = 30 * 60 * 1000,
  maxSessions = 500,
  maxHistory = 20,
  now = () => Date.now(),
} = {}) {
  const sessions = new Map();

  const isExpired = (entry) => now() - entry.updatedAt > ttlMs;

  function getSession(sessionId) {
    if (!sessionId) return null;
    const entry = sessions.get(sessionId);
    if (!entry) return null;
    if (isExpired(entry)) {
      sessions.delete(sessionId);
      return null;
    }
    // Refresh LRU position.
    sessions.delete(sessionId);
    sessions.set(sessionId, entry);
    return entry;
  }

  function getOrCreateSession(sessionId) {
    const existing = getSession(sessionId);
    if (existing) return existing;
    const entry = {
      conversationId: null,
      history: [],
      createdAt: now(),
      updatedAt: now(),
    };
    sessions.set(sessionId, entry);
    while (sessions.size > maxSessions) {
      sessions.delete(sessions.keys().next().value);
    }
    return entry;
  }

  function setConversationId(sessionId, conversationId) {
    const entry = getOrCreateSession(sessionId);
    entry.conversationId = conversationId;
    entry.updatedAt = now();
    return entry;
  }

  function appendHistory(sessionId, role, content) {
    const entry = getOrCreateSession(sessionId);
    entry.history.push({ role, content });
    if (entry.history.length > maxHistory) {
      entry.history = entry.history.slice(-maxHistory);
    }
    entry.updatedAt = now();
    return entry.history;
  }

  function clearSession(sessionId) {
    return sessions.delete(sessionId);
  }

  function size() {
    return sessions.size;
  }

  return { getSession, getOrCreateSession, setConversationId, appendHistory, clearSession, size };
}

/** Shared store used by server.js. */
export const sessionStore = createSessionStore();
