// Edition definitions paraphrase the official Mattel instructions. Internal color
// keys are shared; Stitch prints the yellow family in purple and red in pink.
export const UNO_COLORS = ['red', 'yellow', 'green', 'blue'];
export const UNO_EDITIONS = {
  classic: {
    id: 'classic', name: 'UNO Classic', cardCount: 108, maxPlayers: 10,
    source: 'https://service.mattel.com/instruction_sheets/53641.pdf',
    colorNames: { red: 'Red', yellow: 'Yellow', green: 'Green', blue: 'Blue' },
  },
  stitch: {
    id: 'stitch', name: 'UNO Lilo & Stitch', cardCount: 112, maxPlayers: 10,
    source: 'https://service.mattel.com/instruction_sheets/JCC10%20English.pdf',
    colorNames: { red: 'Pink', yellow: 'Purple', green: 'Green', blue: 'Blue' },
  },
};

function requireRule(condition, message) { if (!condition) throw new Error(message); }

export function normalizeUnoRules(value = {}) {
  requireRule(value && typeof value === 'object' && !Array.isArray(value), 'UNO rules must be an object');
  requireRule(Object.keys(value).every(key => ['edition', 'scoreMode', 'targetScore'].includes(key)), 'Unknown UNO rule');
  const edition = value.edition ?? 'classic';
  const scoreMode = value.scoreMode ?? 'points';
  requireRule(Object.hasOwn(UNO_EDITIONS, edition), 'Choose Classic or Lilo & Stitch UNO');
  requireRule(['points', 'single-round'].includes(scoreMode), 'Choose a 500-point match or a single round');
  requireRule(value.targetScore === undefined || value.targetScore === 500, 'Official UNO matches play to 500 points');
  return { edition, scoreMode, targetScore: 500 };
}

export function unoCardPoints(card) {
  return card.kind === 'number' ? card.value : ['skip', 'reverse', 'draw-two'].includes(card.kind) ? 20 : 50;
}

export function createUnoDeck(edition = 'classic') {
  requireRule(Object.hasOwn(UNO_EDITIONS, edition), 'Unknown UNO edition');
  const cards = [];
  function add(color, kind, value = null, copies = 1) {
    const definitionId = color === 'wild' ? kind : `${color}-${kind === 'number' ? value : kind}`;
    const label = kind === 'number' ? String(value) : ({ skip: 'Skip', reverse: 'Reverse', 'draw-two': 'Draw Two', wild: 'Wild', 'wild-draw-four': 'Wild Draw Four', ohana: 'Ohana' })[kind];
    for (let copy = 0; copy < copies; copy += 1) {
      const card = { id: `${definitionId}-${copy}`, definitionId, kind, color, value, label };
      cards.push({ ...card, points: unoCardPoints(card) });
    }
  }
  for (const color of UNO_COLORS) {
    add(color, 'number', 0);
    for (let number = 1; number <= 9; number += 1) add(color, 'number', number, 2);
    for (const kind of ['skip', 'reverse', 'draw-two']) add(color, kind, null, 2);
  }
  add('wild', 'wild', null, 4);
  add('wild', 'wild-draw-four', null, 4);
  if (edition === 'stitch') add('wild', 'ohana', null, 4);
  return cards;
}
