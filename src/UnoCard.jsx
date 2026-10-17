import React, { createContext, useContext, useEffect, useState } from 'react';

const ArtContext = createContext(null);
export const UNO_COLORS = ['red', 'yellow', 'green', 'blue'];
export const UNO_COLOR_HEX = { red: '#d82335', yellow: '#edc52b', green: '#238443', blue: '#1478bd', wild: '#171717' };
export const unoEditionName = edition => edition === 'stitch' ? 'Disney Lilo & Stitch' : 'Classic';
export const unoCardName = (card, edition = 'classic') => {
  if (!card) return 'Card';
  const color = edition === 'stitch' && card.color === 'red' ? 'Pink' : edition === 'stitch' && card.color === 'yellow' ? 'Purple' : card.color?.[0]?.toUpperCase() + card.color?.slice(1);
  const symbol = card.kind === 'number' ? card.value : ({ 'draw-two': 'Draw Two', 'wild-draw-four': 'Wild Draw Four', ohana: 'Wild Ohana', reverse: 'Reverse', skip: 'Skip', wild: 'Wild' })[card.kind] || card.label || card.kind;
  return `${card.color === 'wild' ? '' : `${color} `}${symbol}`;
};
export const cardSymbol = card => card?.kind === 'number' ? String(card.value) : ({ 'draw-two': '+2', 'wild-draw-four': '+4', ohana: 'Ohana', reverse: '⇄', skip: '⊘', wild: 'WILD' })[card?.kind] || '';

export function UnoArtworkProvider({ children }) {
  const [manifest, setManifest] = useState(null);
  useEffect(() => {
    let active = true;
    fetch('/assets/uno/manifest.json').then(response => response.ok ? response.json() : null).then(value => { if (active) setManifest(value); }).catch(() => {});
    return () => { active = false; };
  }, []);
  return <ArtContext.Provider value={manifest}>{children}</ArtContext.Provider>;
}

function artworkStyle(art) {
  if (!art?.crop) return { backgroundImage: `url("${art.src}")`, backgroundSize: '100% 100%' };
  const { x, y, width, height } = art.crop;
  const sourceWidth = art.sourceWidth || 2000, sourceHeight = art.sourceHeight || 2000;
  return { backgroundImage: `url("${art.src}")`, backgroundSize: `${sourceWidth / width * 100}% ${sourceHeight / height * 100}%`, backgroundPosition: `${sourceWidth === width ? 0 : x / (sourceWidth - width) * 100}% ${sourceHeight === height ? 0 : y / (sourceHeight - height) * 100}%` };
}

/** Printed card faces are cosmetic; legal cards always come from the private server projection. */
export default function UnoCard({ card, back = false, edition = 'classic', className = '', style, label = true }) {
  const manifest = useContext(ArtContext);
  const definitionId = card?.definitionId || (card?.color === 'wild' ? card.kind : `${card?.color}-${card?.kind === 'number' ? card.value : card?.kind}`);
  const art = back ? manifest?.editions?.[edition]?.back : manifest?.editions?.[edition]?.cards?.[definitionId];
  const symbol = cardSymbol(card), wild = card?.color === 'wild' || ['wild', 'wild-draw-four', 'ohana'].includes(card?.kind);
  const [failed, setFailed] = useState(null);
  const src = typeof art === 'string' ? art : art?.src;
  const hasArt = src && failed !== src;
  const ink = edition === 'stitch' ? ({ red: '#e8388e', yellow: '#a679cf', green: '#75b832', blue: '#12a1ce' })[card?.color] : UNO_COLOR_HEX[card?.color];
  return <span className={`uno-card-face ${back ? 'uno-card-back' : ''} ${wild ? 'uno-card-wild' : ''} ${hasArt ? 'uno-card-verified-art' : ''} ${className}`} style={{ '--card-color': ink || '#181818', ...style }} role={label ? 'img' : undefined} aria-label={label ? back ? `${unoEditionName(edition)} card back` : unoCardName(card, edition) : undefined} data-art-status={art?.status || 'drawn-card-face'}>
    {hasArt ? <><span className="uno-print-art" style={typeof art === 'string' ? { backgroundImage: `url("${src}")` } : artworkStyle(art)} /><img className="uno-art-probe" src={src} alt="" onError={() => setFailed(src)} /></> : back ? <><span className="uno-back-oval" /><b className="uno-back-logo">UNO</b><small>®</small></> : <>
      <span className="uno-card-field" />
      {wild && <span className="uno-wild-quadrants"><i /><i /><i /><i /></span>}
      <span className="uno-card-oval" />
      <b className={`uno-card-corner ${card?.kind === 'ohana' || card?.kind === 'wild' ? 'corner-word' : ''}`}>{symbol}</b>
      <b className={`uno-card-symbol kind-${card?.kind}`}>{symbol}</b>
      <b className={`uno-card-corner bottom ${card?.kind === 'ohana' || card?.kind === 'wild' ? 'corner-word' : ''}`}>{symbol}</b>
      {wild && <span className="uno-wild-mark"><i /><i /><i /><i /></span>}
    </>}
  </span>;
}
