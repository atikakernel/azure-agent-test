import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createSessionStore } from '../lib/sessions.js';

test('stores and reuses a conversation id per session', () => {
  const store = createSessionStore();
  store.setConversationId('s1', 'conv-123');
  assert.equal(store.getSession('s1').conversationId, 'conv-123');
  assert.equal(store.getSession('unknown'), null);
  assert.equal(store.getSession(null), null);
});

test('history is capped and ordered', () => {
  const store = createSessionStore({ maxHistory: 3 });
  store.appendHistory('s1', 'user', 'one');
  store.appendHistory('s1', 'assistant', 'two');
  store.appendHistory('s1', 'user', 'three');
  store.appendHistory('s1', 'assistant', 'four');
  const history = store.getSession('s1').history;
  assert.deepEqual(history.map((h) => h.content), ['two', 'three', 'four']);
});

test('sessions expire after the TTL', () => {
  let now = 1000;
  const store = createSessionStore({ ttlMs: 100, now: () => now });
  store.setConversationId('s1', 'conv-123');
  now = 1050;
  assert.ok(store.getSession('s1'));
  now = 1201;
  assert.equal(store.getSession('s1'), null);
});

test('clearSession drops context and size is capped', () => {
  const store = createSessionStore({ maxSessions: 2 });
  store.getOrCreateSession('a');
  store.getOrCreateSession('b');
  store.getOrCreateSession('c');
  assert.equal(store.size(), 2);
  assert.equal(store.getSession('a'), null); // evicted (LRU)
  assert.equal(store.clearSession('c'), true);
  assert.equal(store.clearSession('c'), false);
});
