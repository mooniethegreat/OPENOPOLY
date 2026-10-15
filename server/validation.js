export function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function text(value, label, min = 1, max = 120) {
  assert(typeof value === 'string', `${label} must be text`);
  const result = value.trim().replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
  assert(result.length >= min && result.length <= max, `${label} must be ${min}–${max} characters`);
  return result;
}

export function integer(value, label, min = 0, max = 1000000) {
  assert(Number.isSafeInteger(value) && value >= min && value <= max, `${label} must be a whole number from ${min} to ${max}`);
  return value;
}

export function getPlayer(room, id) {
  const player = room.players.find(p => p.id === id);
  assert(player, 'Player is not in this room');
  return player;
}

export function gamePlayer(room, id) {
  assert(room.game && room.status === 'playing', 'Start the game first');
  const player = room.game.players.find(p => p.id === id);
  assert(player && !player.bankrupt, 'Player is no longer active');
  return player;
}

export function onlyFields(object, keys, label = 'Action') {
  assert(object && typeof object === 'object' && !Array.isArray(object), `${label} must be an object`);
  for (const key of Object.keys(object)) assert(keys.includes(key), `${label} contains unsupported field: ${key}`);
}
