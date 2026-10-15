// US classic board economics. Theme artwork and labels never change these IDs.
const street = (id, name, group, color, price, rents, houseCost) => ({ id, index: id, name, type: 'property', group, color, price, mortgage: price / 2, rents, houseCost });
const railroad = (id, name) => ({ id, index: id, name, type: 'railroad', group: 'railroad', color: '#27332e', price: 200, mortgage: 100, rents: [25, 50, 100, 200] });
const utility = (id, name) => ({ id, index: id, name, type: 'utility', group: 'utility', color: '#697e84', price: 150, mortgage: 75, rents: [4, 10] });
const space = (id, name, type, extra = {}) => ({ id, index: id, name, type, ...extra });

export const BOARD = [
  space(0, 'GO', 'go'),
  street(1, 'Mediterranean Avenue', 'brown', '#875338', 60, [2, 10, 30, 90, 160, 250], 50),
  space(2, 'Community Chest', 'chest'),
  street(3, 'Baltic Avenue', 'brown', '#875338', 60, [4, 20, 60, 180, 320, 450], 50),
  space(4, 'Income Tax', 'tax', { amount: 200 }),
  railroad(5, 'Reading Railroad'),
  street(6, 'Oriental Avenue', 'lightBlue', '#a9dce9', 100, [6, 30, 90, 270, 400, 550], 50),
  space(7, 'Chance', 'chance'),
  street(8, 'Vermont Avenue', 'lightBlue', '#a9dce9', 100, [6, 30, 90, 270, 400, 550], 50),
  street(9, 'Connecticut Avenue', 'lightBlue', '#a9dce9', 120, [8, 40, 100, 300, 450, 600], 50),
  space(10, 'Jail / Just Visiting', 'jail'),
  street(11, 'St. Charles Place', 'pink', '#d44b94', 140, [10, 50, 150, 450, 625, 750], 100),
  utility(12, 'Electric Company'),
  street(13, 'States Avenue', 'pink', '#d44b94', 140, [10, 50, 150, 450, 625, 750], 100),
  street(14, 'Virginia Avenue', 'pink', '#d44b94', 160, [12, 60, 180, 500, 700, 900], 100),
  railroad(15, 'Pennsylvania Railroad'),
  street(16, 'St. James Place', 'orange', '#ef9332', 180, [14, 70, 200, 550, 750, 950], 100),
  space(17, 'Community Chest', 'chest'),
  street(18, 'Tennessee Avenue', 'orange', '#ef9332', 180, [14, 70, 200, 550, 750, 950], 100),
  street(19, 'New York Avenue', 'orange', '#ef9332', 200, [16, 80, 220, 600, 800, 1000], 100),
  space(20, 'Free Parking', 'freeParking'),
  street(21, 'Kentucky Avenue', 'red', '#df3d42', 220, [18, 90, 250, 700, 875, 1050], 150),
  space(22, 'Chance', 'chance'),
  street(23, 'Indiana Avenue', 'red', '#df3d42', 220, [18, 90, 250, 700, 875, 1050], 150),
  street(24, 'Illinois Avenue', 'red', '#df3d42', 240, [20, 100, 300, 750, 925, 1100], 150),
  railroad(25, 'B. & O. Railroad'),
  street(26, 'Atlantic Avenue', 'yellow', '#f1d85a', 260, [22, 110, 330, 800, 975, 1150], 150),
  street(27, 'Ventnor Avenue', 'yellow', '#f1d85a', 260, [22, 110, 330, 800, 975, 1150], 150),
  utility(28, 'Water Works'),
  street(29, 'Marvin Gardens', 'yellow', '#f1d85a', 280, [24, 120, 360, 850, 1025, 1200], 150),
  space(30, 'Go To Jail', 'goToJail'),
  street(31, 'Pacific Avenue', 'green', '#39a879', 300, [26, 130, 390, 900, 1100, 1275], 200),
  street(32, 'North Carolina Avenue', 'green', '#39a879', 300, [26, 130, 390, 900, 1100, 1275], 200),
  space(33, 'Community Chest', 'chest'),
  street(34, 'Pennsylvania Avenue', 'green', '#39a879', 320, [28, 150, 450, 1000, 1200, 1400], 200),
  railroad(35, 'Short Line'),
  space(36, 'Chance', 'chance'),
  street(37, 'Park Place', 'darkBlue', '#286bb4', 350, [35, 175, 500, 1100, 1300, 1500], 200),
  space(38, 'Luxury Tax', 'tax', { amount: 100 }),
  street(39, 'Boardwalk', 'darkBlue', '#286bb4', 400, [50, 200, 600, 1400, 1700, 2000], 200),
];

export const PROPERTY_SPACES = BOARD.filter((s) => s.price);
export const GROUPS = Object.fromEntries([...new Set(PROPERTY_SPACES.map((s) => s.group))].map((group) => [group, PROPERTY_SPACES.filter((s) => s.group === group).map((s) => s.id)]));
export const TOKENS = [
  { id: 'car', name: 'Racecar', symbol: '🚗' }, { id: 'hat', name: 'Top Hat', symbol: '🎩' },
  { id: 'dog', name: 'Scottie Dog', symbol: '🐕' }, { id: 'ship', name: 'Battleship', symbol: '🚢' },
  { id: 'cat', name: 'Cat', symbol: '🐈' }, { id: 'penguin', name: 'Penguin', symbol: '🐧' },
  { id: 'thimble', name: 'Thimble', symbol: '🪡' }, { id: 'duck', name: 'Rubber Duck', symbol: '🦆' },
];
export const PLAYER_COLORS = ['#f4ca64', '#62b8ed', '#e889a7', '#82cd9b', '#b79bed', '#f39469', '#9ae0db', '#efeaab'];
export const THEMES = {
  classic: { id: 'classic', name: 'Classic', subtitle: 'Atlantic City • US classic rules', boardNames: {} },
  inland: { id: 'inland', name: 'Inland Empire', subtitle: 'Community theme • classic game economics', boardNames: {} },
};
export const MONEY_DENOMINATIONS = [500, 100, 50, 20, 10, 5, 1];

// Card text is a concise functional paraphrase of the traditional US card set.
export const CHANCE_CARDS = [
  { id: 'chance-boardwalk', title: 'Boardwalk', text: 'Move to Boardwalk.', effect: 'advance', target: 39 },
  { id: 'chance-go', title: 'Advance to GO', text: 'Move to GO and receive $200.', effect: 'advance', target: 0 },
  { id: 'chance-illinois', title: 'Illinois Avenue', text: 'Move to Illinois Avenue. Receive $200 if you pass GO.', effect: 'advance', target: 24 },
  { id: 'chance-stcharles', title: 'St. Charles Place', text: 'Move to St. Charles Place. Receive $200 if you pass GO.', effect: 'advance', target: 11 },
  { id: 'chance-railroad-1', title: 'Nearest Railroad', text: 'Move to the next railroad. If owned, pay twice its normal rent.', effect: 'railroad' },
  { id: 'chance-railroad-2', title: 'Nearest Railroad', text: 'Move to the next railroad. If owned, pay twice its normal rent.', effect: 'railroad' },
  { id: 'chance-utility', title: 'Nearest Utility', text: 'Move to the next utility. If owned, roll fresh dice and pay ten times the total.', effect: 'utility' },
  { id: 'chance-dividend', title: 'Bank Dividend', text: 'Receive $50 from the bank.', effect: 'receive', amount: 50 },
  { id: 'chance-jail-free', title: 'Get Out of Jail Free', text: 'Keep this card until used or traded.', effect: 'jailCard' },
  { id: 'chance-back-three', title: 'Back Three Spaces', text: 'Move backward three spaces and resolve the destination.', effect: 'back', amount: 3 },
  { id: 'chance-jail', title: 'Go to Jail', text: 'Move directly to jail. Do not receive a GO payment.', effect: 'jail' },
  { id: 'chance-repairs', title: 'General Repairs', text: 'Pay $25 per house and $100 per hotel you own.', effect: 'repairs', house: 25, hotel: 100 },
  { id: 'chance-speeding', title: 'Speeding Fine', text: 'Pay $15 to the bank.', effect: 'pay', amount: 15 },
  { id: 'chance-reading', title: 'Reading Railroad', text: 'Move to Reading Railroad. Receive $200 if you pass GO.', effect: 'advance', target: 5 },
  { id: 'chance-chairman', title: 'Chairman of the Board', text: 'Pay $50 to every other active player.', effect: 'payEach', amount: 50 },
  { id: 'chance-loan', title: 'Building Loan', text: 'Receive $150 from the bank.', effect: 'receive', amount: 150 },
];
export const CHEST_CARDS = [
  { id: 'chest-go', title: 'Advance to GO', text: 'Move to GO and receive $200.', effect: 'advance', target: 0 },
  { id: 'chest-bank-error', title: 'Bank Correction', text: 'Receive $200 from the bank.', effect: 'receive', amount: 200 },
  { id: 'chest-doctor', title: 'Doctor Fee', text: 'Pay $50 to the bank.', effect: 'pay', amount: 50 },
  { id: 'chest-stock', title: 'Stock Sale', text: 'Receive $50 from the bank.', effect: 'receive', amount: 50 },
  { id: 'chest-jail-free', title: 'Get Out of Jail Free', text: 'Keep this card until used or traded.', effect: 'jailCard' },
  { id: 'chest-jail', title: 'Go to Jail', text: 'Move directly to jail. Do not receive a GO payment.', effect: 'jail' },
  { id: 'chest-holiday', title: 'Holiday Fund', text: 'Receive $100 from the bank.', effect: 'receive', amount: 100 },
  { id: 'chest-refund', title: 'Tax Refund', text: 'Receive $20 from the bank.', effect: 'receive', amount: 20 },
  { id: 'chest-birthday', title: 'Birthday', text: 'Each other active player pays you $10.', effect: 'receiveEach', amount: 10 },
  { id: 'chest-insurance', title: 'Life Insurance', text: 'Receive $100 from the bank.', effect: 'receive', amount: 100 },
  { id: 'chest-hospital', title: 'Hospital Fee', text: 'Pay $100 to the bank.', effect: 'pay', amount: 100 },
  { id: 'chest-school', title: 'School Fee', text: 'Pay $50 to the bank.', effect: 'pay', amount: 50 },
  { id: 'chest-consultancy', title: 'Consultancy Fee', text: 'Receive $25 from the bank.', effect: 'receive', amount: 25 },
  { id: 'chest-repairs', title: 'Street Repairs', text: 'Pay $40 per house and $115 per hotel you own.', effect: 'repairs', house: 40, hotel: 115 },
  { id: 'chest-beauty', title: 'Contest Prize', text: 'Receive $10 from the bank.', effect: 'receive', amount: 10 },
  { id: 'chest-inheritance', title: 'Inheritance', text: 'Receive $100 from the bank.', effect: 'receive', amount: 100 },
];

const INLAND_NAMES = ['GO Inland Empire', 'The Mule Car', 'Big Fun', 'Calico Ghost Town', 'Property Tax', 'Cucamonga Service Station', 'Graber Olive House', 'Contingency', 'Victoria Gardens', 'Ontario Town Square', 'Traffic Jam / Detour', "The Original McDonald's", 'National Orange Show', "Winchell's Donut House", 'The Green Shack Market', 'Wigwam Motel', 'Castle Park', 'Big Fun', 'Boomers! Upland', 'Santa Ana River Trail', 'I ♥ Inland Empire', 'Glen Helen Amphitheatre', 'Contingency', 'San Manuel Stadium', 'Auto Club Speedway', 'Santa Fe Smokestack', 'California Theatre', 'Riverside Community Players', 'Mt. Rubidoux Park', 'March Field Air Museum', 'Go To Traffic Jam', 'Lake Arrowhead', 'Big Bear Lake', 'Big Fun', 'San Bernardino Mountains', "Bono's Orange Stand", 'Wine Country', 'Contingency', 'Parking Ticket', 'The 909'];
const INLAND_PRICES = { 1: 70, 3: 80, 5: 250, 6: 90, 8: 90, 9: 100, 11: 130, 12: 175, 13: 130, 14: 150, 15: 250, 16: 170, 18: 170, 19: 190, 21: 210, 23: 210, 24: 230, 25: 250, 26: 250, 27: 250, 28: 175, 29: 270, 31: 290, 32: 290, 34: 310, 35: 250, 36: 350, 39: 400 };
const INLAND_COLORS = { brown: '#b64b38', lightBlue: '#e88739', pink: '#e3ce51', orange: '#a4cb46', red: '#d5c5e0', yellow: '#9a77bf', green: '#9cd5bd', darkBlue: '#775072' };
export const INLAND_BOARD = BOARD.map((original, id) => {
  const template = id === 36 ? BOARD[37] : id === 37 ? BOARD[36] : original;
  const custom = id === 1;
  return { ...template, rents: template.rents && [...template.rents], id, index: id, name: custom ? 'The Resort' : INLAND_NAMES[id],
    ...(custom ? { subtitle: 'Apartment complex', custom: true, originalName: INLAND_NAMES[id], customization: { requestedBy: 'host', kind: 'property-replacement', replaces: INLAND_NAMES[id], retainedEconomics: true } } : {}),
    ...(INLAND_COLORS[template.group] ? { color: INLAND_COLORS[template.group] } : {}),
    ...(INLAND_PRICES[id] ? { price: INLAND_PRICES[id] } : {}), ...(id === 38 ? { amount: 75 } : {}),
    verification: { name: custom ? 'user-customization' : 'box-photo', price: template.price ? 'box-photo' : undefined, ...(custom ? { priceSourceProperty: INLAND_NAMES[id] } : {}), economics: template.price ? ([21, 39].includes(id) ? 'visible-deed-photo' : 'classic-fallback-unverified') : 'box-photo' },
  };
});

export const EDITION_INFO = {
  classic: { id: 'classic', name: 'Classic Openopoly', maxPlayers: 8, houseLabel: 'House', hotelLabel: 'Hotel', deckLabels: { chance: 'Chance', chest: 'Community Chest' }, verification: 'US classic economics with the traditional 2008 card set; digital rent collection is automatic.' },
  inland: { id: 'inland', name: 'Inland Empire-opoly', maxPlayers: 6, houseLabel: 'City Block', hotelLabel: 'Key to the City', deckLabels: { chance: 'Contingency', chest: 'Big Fun' }, customizations: [{ propertyId: 1, name: 'The Resort', replaces: 'The Mule Car', price: 70, requestedBy: 'host' }], verification: 'Researched adaptation: original board names, prices, two deeds and two Contingency effects verified from product photographs. Custom property: The Resort apartment complex replaces The Mule Car at $70, preserving that slot’s economics. General rules follow a published Late for the Sky rulebook. Remaining rents, mortgages, building stock and card effects use explicitly marked classic fallbacks; the complete Inland Empire deck was not available online.' },
};
export function normalizeEdition(value) { return value === 'inland' || value === 'inland-empire' ? 'inland' : 'classic'; }
export const BOARDS = { classic: BOARD, inland: INLAND_BOARD, 'inland-empire': INLAND_BOARD };
export function getBoard(gameOrEdition) { return BOARDS[normalizeEdition(typeof gameOrEdition === 'string' ? gameOrEdition : gameOrEdition?.edition)]; }
export function getPropertySpaces(gameOrEdition) { return getBoard(gameOrEdition).filter((s) => s.price); }
export function getGroups(gameOrEdition) {
  const properties = getPropertySpaces(gameOrEdition);
  return Object.fromEntries([...new Set(properties.map((s) => s.group))].map((key) => [key, properties.filter((s) => s.group === key).map((s) => s.id)]));
}

function inlandCard(card) {
  const target = card.target === 37 ? 36 : card.target;
  let title = card.title, text = card.text;
  if (card.effect === 'advance') {
    title = INLAND_NAMES[target]; text = `Move to ${title}. Receive $200 if you pass GO.`;
  } else if (card.effect === 'jail') { title = 'Traffic Jam'; text = 'Move directly to Traffic Jam without a GO payment.'; }
  else if (card.effect === 'jailCard') { title = 'Leave Traffic Jam'; text = 'Classic fallback: keep until used or traded.'; }
  else if (card.effect === 'repairs') { text = `Pay $${card.house} per City Block and $${card.hotel} per Key to the City.`; }
  return { ...card, id: `inland-${card.id}`, target, title, text, verification: 'classic-fallback-unverified' };
}
const INLAND_CHANCE_CARDS = CHANCE_CARDS.map(inlandCard);
INLAND_CHANCE_CARDS[7] = { id: 'inland-contingency-route66', title: 'Back to Route 66 Rendezvous', text: 'Your classic car takes third place. Receive $20.', effect: 'receive', amount: 20, verification: 'visible-card-photo' };
INLAND_CHANCE_CARDS[12] = { id: 'inland-contingency-donuts', title: "Too Many Winchell's Donuts", text: 'Lose your next turn after eating too many old-fashioned donuts.', effect: 'loseTurn', amount: 1, verification: 'visible-card-photo' };
export const CARD_DECKS = { classic: { chance: CHANCE_CARDS, chest: CHEST_CARDS }, inland: { chance: INLAND_CHANCE_CARDS, chest: CHEST_CARDS.map(inlandCard) } };
export function getCardDecks(gameOrEdition) { return CARD_DECKS[normalizeEdition(typeof gameOrEdition === 'string' ? gameOrEdition : gameOrEdition?.edition)]; }
