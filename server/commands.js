import { createHash } from 'node:crypto';

export const ACTION_PROTOCOL = 2;
export const COMMAND_RECEIPT_LIMIT = 256;
const META = ['commandId', 'expectedDecisionVersion', 'expectedTurn', 'expectedCurrentPlayerId', 'expectedPhase'];
const SENSITIVE_CONTRACTS = new Set(['contract:propose', 'contract:revise', 'contract:sign', 'contract:confirm', 'contract:pay']);
const validCommandId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{16,100}$/.test(value);

function reject(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}

export function decodeCommand(input) {
  if (!validCommandId(input.commandId)) {
    reject('COMMAND_METADATA_REQUIRED', 'Refresh this page to use the updated multiplayer controls. No action was applied.');
  }
  return {
    id: input.commandId,
    hash: createHash('sha256').update(JSON.stringify(canonical(input))).digest('hex'),
    input,
    action: Object.fromEntries(Object.entries(input).filter(([key]) => !META.includes(key))),
  };
}

export function commandOutcome(room, playerId, commandId) {
  if (!validCommandId(commandId)) reject('INVALID_COMMAND_ID', 'Choose a valid action identifier');
  const receipt = (room._commandReceipts ?? []).find(item => item.playerId === playerId && item.commandId === commandId);
  return receipt
    ? { status: 'applied', commandId, appliedVersion: receipt.appliedVersion, appliedDecisionVersion: receipt.appliedDecisionVersion }
    : { status: 'unknown', commandId };
}

export function findCommandReceipt(room, playerId, command) {
  const receipt = (room._commandReceipts ?? []).find(item => item.playerId === playerId && item.commandId === command.id);
  if (receipt && receipt.hash !== command.hash) reject('COMMAND_ID_CONFLICT', 'This action identifier was already used for different instructions. Review the current state and try again.');
  return receipt;
}

export function decisionContext(room) {
  return {
    expectedDecisionVersion: room.decisionVersion ?? 0,
    expectedTurn: room.game?.turn ?? null,
    expectedCurrentPlayerId: room.game?.currentPlayerId ?? null,
    expectedPhase: room.game?.phase ?? null,
  };
}

export function needsDecisionContext(type) {
  if (type === 'room:start' || type === 'money:send' || SENSITIVE_CONTRACTS.has(type)) return true;
  return !['room:', 'chat:', 'vote:', 'contract:'].some(prefix => type.startsWith(prefix));
}

export function validateDecisionContext(room, command) {
  if (!needsDecisionContext(command.action.type)) return;
  const expected = decisionContext(room);
  if (!Number.isSafeInteger(command.input.expectedDecisionVersion) || command.input.expectedDecisionVersion < 0 || Object.keys(expected).some(key => !Object.hasOwn(command.input, key))) {
    reject('COMMAND_METADATA_REQUIRED', 'Refresh this page to use the updated multiplayer controls. No action was applied.');
  }
  if (Object.entries(expected).some(([key, value]) => command.input[key] !== value)) {
    reject('STALE_DECISION', 'The game changed before this action arrived. Review the current turn and choose again. No action was applied.');
  }
}

export function rememberCommand(room, playerId, command) {
  const receipt = {
    playerId, commandId: command.id, hash: command.hash,
    appliedVersion: room.version, appliedDecisionVersion: room.decisionVersion ?? 0,
    at: new Date().toISOString(),
  };
  room._commandReceipts = [...(room._commandReceipts ?? []), receipt].slice(-COMMAND_RECEIPT_LIMIT);
  return receipt;
}
