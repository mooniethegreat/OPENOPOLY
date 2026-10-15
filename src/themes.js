export const THEMES = {
  classic: { id: 'classic', name: 'The original', subtitle: 'CLASSIC MONOPOLY', short: 'Classic', color: '#b8d9ba' },
  'inland-empire': { id: 'inland-empire', name: 'Inland Empire', subtitle: 'INLAND EMPIRE-OPOLY', short: 'Inland Empire', color: '#e7d9b4' },
};

let inlandData = null;
export function setInlandData(data) { inlandData = data; }
export function getInlandData() { return inlandData; }
export function spaceName(space, theme = 'classic') {
  if (theme !== 'inland-empire' || !inlandData) return space.name;
  const names = inlandData.spaces || inlandData.properties || inlandData.names || inlandData;
  const item = Array.isArray(names) ? names.find(item => (item.index ?? item.id) === space.index) : names[space.index];
  return typeof item === 'string' ? item : item?.name || space.name;
}

export const money = value => `$${Number(value || 0).toLocaleString('en-US')}`;
export const shortId = value => String(value || '').slice(0, 6);
export const displayToken = token => typeof token === 'object' ? token.id : token || 'hat';
