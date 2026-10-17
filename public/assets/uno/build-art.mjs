// Rebuild the source-art atlas and manifest. Run from the repository root.
// No AI-generated character art: all embedded illustrations come from the listed source files.
import fs from 'node:fs';
const base = 'public/assets/uno';
const colors = ['red', 'yellow', 'green', 'blue'];
const symbols = Array.from({ length: 10 }, (_, i) => String(i)).concat(['skip', 'reverse', 'draw-two']);
const manifest = {
  schemaVersion: 1,
  retrievedAt: '2026-10-17',
  notes: 'Classic is a CC0 vector reproduction, not an official scan. Stitch uses complete official product crops where available; gaps use explicitly adapted source-art faces. See docs/uno-research.md.',
  sources: {
    classicDeck: { title: 'UNO cards deck.svg', author: 'Dmitry Fomin', url: 'https://commons.wikimedia.org/wiki/File:UNO_cards_deck.svg', license: 'CC0-1.0' },
    unoLogo: { title: 'UNO Logo.svg', author: 'Mattel', url: 'https://commons.wikimedia.org/wiki/File:UNO_Logo.svg', license: 'Commons PD-textlogo; trademark rights remain' },
    mattelStitch: { title: 'Mattel JCC10 product gallery', url: 'https://shopping.mattel.com/es-es/products/uno-disney-lilo-y-stitch-juego-de-cartas-jcc10-es-es', license: 'Copyright Mattel / Disney; no open license asserted', files: { 'product-3.png': { url: 'https://shopping.mattel.com/cdn/shop/files/p4pe1wdycbiqhlzh3nal_bbf17f09-5cbd-4855-bc4f-ba5230123d7c.png?v=1738010366', sha256: '7e7760dfd5939ee22e79f2ca7467706c984f9252cecbe15ab80f5d5b4c206fd9' }, 'product-4.png': { url: 'https://shopping.mattel.com/cdn/shop/files/slucww60cefzohtvaycp.png?v=1738010366', sha256: '54ab5d3f41d5cd5e65d7d668e680c4653c18bfaef289ef2924c9f3cdbec02c1a' } } },
    reviewNumbers: { title: 'UNO Disney\'s Lilo and Stitch Card Meanings', author: 'Eric Mortensen / Geeky Hobbies', url: 'https://www.geekyhobbies.com/uno-disneys-lilo-and-stitch-card-meanings/', imageUrl: 'https://www.geekyhobbies.com/wp-content/uploads/2024/09/UNO-Disneys-Lilo-and-Stitch-Number-Cards.jpg', license: 'Owner review photography; no open license asserted' },
  },
  editions: { classic: { cards: {}, back: {} }, stitch: { colorNames: { red: 'Pink', yellow: 'Purple', green: 'Green', blue: 'Blue' }, cards: {}, back: {} } },
};
for (let row = 0; row < 4; row++) for (let col = 0; col < 13; col++) {
  manifest.editions.classic.cards[`${colors[row]}-${symbols[col]}`] = { src: '/assets/uno/classic/deck-source.svg', crop: { x: 1 + col * 240, y: 1 + row * 360, width: 240, height: 360 }, sourceWidth: 3362, sourceHeight: 2882, status: 'cc0-vector-reproduction', sourceId: 'classicDeck' };
}
for (const [id, y] of [['wild', 1], ['wild-draw-four', 1441]]) manifest.editions.classic.cards[id] = { src: '/assets/uno/classic/deck-source.svg', crop: { x: 3121, y, width: 240, height: 360 }, sourceWidth: 3362, sourceHeight: 2882, status: 'cc0-vector-reproduction', sourceId: 'classicDeck' };
const logo = fs.readFileSync(`${base}/classic/uno-logo-source.svg`).toString('base64');
fs.writeFileSync(`${base}/classic/back.svg`, `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="360" viewBox="0 0 240 360"><title>UNO card back - digital layout using Mattel's logo</title><rect width="240" height="360" rx="23" fill="white"/><rect x="10" y="10" width="220" height="340" rx="18" fill="#111"/><ellipse cx="120" cy="180" rx="100" ry="145" fill="#ed1c24" transform="rotate(25 120 180)"/><image x="7" y="102" width="226" height="158" href="data:image/svg+xml;base64,${logo}"/></svg>`);
manifest.editions.classic.back = { src: '/assets/uno/classic/back.svg', sourceWidth: 240, sourceHeight: 360, status: 'adapted-logo-layout', sourceId: 'unoLogo' };
const exact = {
  'wild-draw-four': { image: 3, x: 365, y: 60, width: 373, height: 579 },
  wild: { image: 3, x: 816, y: 60, width: 374, height: 579 },
  ohana: { image: 3, x: 1267, y: 60, width: 374, height: 579 },
  'blue-draw-two': { image: 3, x: 366, y: 717, width: 373, height: 581 },
  'green-reverse': { image: 3, x: 1267, y: 717, width: 373, height: 581 },
  'green-9': { image: 3, x: 366, y: 1361, width: 373, height: 579 },
  'yellow-skip': { image: 3, x: 816, y: 1361, width: 374, height: 579 },
  'yellow-7': { image: 3, x: 1267, y: 1361, width: 373, height: 579 },
  'red-0': { image: 4, x: 1197, y: 404, width: 187, height: 285 },
  'green-0': { image: 4, x: 1226, y: 711, width: 183, height: 287 },
  'blue-0': { image: 4, x: 1211, y: 1023, width: 186, height: 287 },
  'yellow-0': { image: 4, x: 1247, y: 1333, width: 186, height: 283 },
  'green-skip': { image: 4, x: 1058, y: 1640, width: 183, height: 288 },
};
const photoCrops = [
  { x: 280, y: 330, width: 360, height: 290 }, { x: 720, y: 330, width: 320, height: 290 },
  { x: 1140, y: 320, width: 280, height: 300 }, { x: 1490, y: 300, width: 330, height: 325 },
  { x: 1850, y: 330, width: 370, height: 310 }, { x: 110, y: 770, width: 440, height: 410 },
  { x: 665, y: 715, width: 385, height: 410 }, { x: 1140, y: 710, width: 390, height: 450 },
  { x: 1580, y: 735, width: 410, height: 415 }, { x: 2010, y: 650, width: 400, height: 490 },
];
const photo = fs.readFileSync(`${base}/stitch/review-number-cards.jpg`).toString('base64');
const product = fs.readFileSync(`${base}/stitch/product-3.png`).toString('base64');
const suits = { red: { color: '#cc2764', light: '#ef9dbb' }, yellow: { color: '#a469a4', light: '#e3b8db' }, green: { color: '#2c8053', light: '#b9d67e' }, blue: { color: '#167ca6', light: '#91d4e7' } };
const illustrations = ['Lilo bathing Stitch', 'Stitch', 'Lilo dancing', 'Nani surfing', 'David surfing', 'Jumba', 'Pleakley', 'Cobra Bubbles', 'Lilo and Stitch on a bicycle', 'Grand Councilwoman', 'Lilo and Stitch resting', 'Captain Gantu', 'Jumba and Pleakley'];
const defs = `<image id="photo" width="2560" height="1440" href="data:image/jpeg;base64,${photo}"/><image id="product" width="2000" height="2000" href="data:image/png;base64,${product}"/>`;
let cells = '';
for (let row = 0; row < 4; row++) for (let col = 0; col < 13; col++) {
  const color = colors[row], key = `${color}-${symbols[col]}`, suit = suits[color];
  const symbol = col < 10 ? String(col) : ({ skip: '\u2298', reverse: '\u21c4', 'draw-two': '+2' })[symbols[col]];
  const crop = col < 10 ? photoCrops[col] : exact[col === 10 ? 'yellow-skip' : col === 11 ? 'green-reverse' : 'blue-draw-two'];
  const scaleX = (col < 10 ? 210 : 220) / crop.width, scaleY = (col < 10 ? 240 : 325) / crop.height;
  const art = `<g clip-path="url(#window)"><g${col < 10 ? ' clip-path="url(#photo-area)"' : ''}><use href="#${col < 10 ? 'photo' : 'product'}" transform="translate(${(col < 10 ? 15 : 10) - crop.x * scaleX} ${(col < 10 ? 75 : 17) - crop.y * scaleY}) scale(${scaleX} ${scaleY})"/></g></g>`;
  cells += `<g transform="translate(${col * 240} ${row * 360})"><rect width="240" height="360" rx="22" fill="white"/><rect x="9" y="9" width="222" height="342" rx="17" fill="${suit.color}"/><path d="M25 298 Q2 155 197 49 Q244 212 51 324" fill="${suit.light}"/>${art}<rect x="13" y="15" width="${col === 12 ? 91 : 68}" height="66" rx="15" fill="${suit.color}"/><g transform="rotate(180 120 180)"><rect x="13" y="15" width="${col === 12 ? 91 : 68}" height="66" rx="15" fill="${suit.color}"/></g><g fill="white" stroke="#19313a" stroke-width="1.1" paint-order="stroke" font-family="Arial,sans-serif" font-weight="900" font-size="${col === 12 ? 48 : 56}"><text x="26" y="67">${symbol}</text><text x="26" y="67" transform="rotate(180 120 180)">${symbol}</text></g></g>`;
  manifest.editions.stitch.cards[key] = { src: '/assets/uno/stitch/adapted-atlas.svg', crop: { x: col * 240, y: row * 360, width: 240, height: 360 }, sourceWidth: 3120, sourceHeight: 1440, status: 'adapted-source-art', sourceId: col < 10 ? 'reviewNumbers' : 'mattelStitch', adaptation: 'Source illustration cropped into a digital suit frame; not an exact printed face.', illustration: illustrations[col] };
}
fs.writeFileSync(`${base}/stitch/adapted-atlas.svg`, `<svg xmlns="http://www.w3.org/2000/svg" width="3120" height="1440" viewBox="0 0 3120 1440" preserveAspectRatio="none"><title>Adapted Lilo and Stitch source-art faces - not official flat scans</title><defs>${defs}<clipPath id="window"><ellipse cx="120" cy="180" rx="100" ry="136"/></clipPath><clipPath id="photo-area"><rect x="15" y="75" width="210" height="240"/></clipPath></defs>${cells}</svg>`);
for (const [key, { image, ...crop }] of Object.entries(exact)) manifest.editions.stitch.cards[key] = { src: `/assets/uno/stitch/product-${image}.png`, crop, sourceWidth: 2000, sourceHeight: 2000, status: 'official-product-crop', sourceId: 'mattelStitch' };
manifest.editions.stitch.back = { src: '/assets/uno/stitch/product-3.png', crop: { x: 816, y: 717, width: 374, height: 581 }, sourceWidth: 2000, sourceHeight: 2000, status: 'official-product-crop', sourceId: 'mattelStitch' };
manifest.editions.stitch.artSummary = { frontDefinitions: 55, officialProductCrops: 13, adaptedSourceArt: 42, completeOfficialScanSet: false };
manifest.editions.classic.artSummary = { frontDefinitions: 54, cc0VectorReproductions: 54, officialScanSet: false };
fs.writeFileSync(`${base}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n');
fs.writeFileSync(`${base}/stitch/source-map.json`, JSON.stringify({ photoCrops, exact, notes: 'Official crops reference 2000x2000 product images. Photo crops reference the 2560x1440 review photo. Adapted atlas uses a digital suit frame with original character artwork; it is not a full official scan set.' }, null, 2) + '\n');
console.log(JSON.stringify({ classic: Object.keys(manifest.editions.classic.cards).length, stitch: Object.keys(manifest.editions.stitch.cards).length, exact: Object.keys(exact).length, adaptedAtlasBytes: fs.statSync(`${base}/stitch/adapted-atlas.svg`).size }));
