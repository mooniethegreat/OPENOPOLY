import { randomUUID } from 'node:crypto';
import { text, onlyFields } from './validation.js';

export const CHAT_HISTORY_LIMIT = 150;

export function sendChat(room, actorId, action) {
  onlyFields(action, ['type', 'text']);
  const message = { id: randomUUID(), playerId: actorId, text: text(action.text, 'Message', 1, 500), at: new Date().toISOString() };
  room.chat = [...(room.chat ?? []), message].slice(-CHAT_HISTORY_LIMIT);
  return message;
}
