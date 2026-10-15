import React from 'react';

export const EMOTE_OPTIONS = [
  { kind: 'happy', label: 'Happy' }, { kind: 'angry', label: 'Angry' },
  { kind: 'laugh', label: 'Laugh' }, { kind: 'cry', label: 'Cry' },
  { kind: 'middle-finger', label: 'Middle finger' }, { kind: 'poop', label: 'Poop toss' },
];
export const emoteName = kind => EMOTE_OPTIONS.find(item => item.kind === kind)?.label || 'Reaction';

export default function EmoteArt({ kind, className = '' }) {
  if (kind === 'poop') return <svg className={className} viewBox="0 0 80 80" aria-hidden="true"><path d="M53 15c-4 4-15 3-13-6-13 7-14 14-8 19-13-1-19 8-13 15-15 1-16 17-5 21 11 5 44 5 54-2 9-6 2-18-8-19 8-10-1-19-12-17 4-3 6-7 5-11Z" fill="#995c37" stroke="#4c301f" strokeWidth="3" strokeLinejoin="round" /><path d="M24 43c12 4 24 4 36 0M22 28c11 6 19 6 27 1" fill="none" stroke="#c38b59" strokeWidth="3" strokeLinecap="round" /><ellipse cx="29" cy="49" rx="8" ry="10" fill="#fff9e8" /><ellipse cx="50" cy="49" rx="8" ry="10" fill="#fff9e8" /><circle cx="31" cy="51" r="3.4" fill="#24261f" /><circle cx="48" cy="51" r="3.4" fill="#24261f" /><path d="M33 63q7 4 14-1" fill="none" stroke="#38251a" strokeWidth="3" strokeLinecap="round" /></svg>;
  if (kind === 'middle-finger') return <svg className={className} viewBox="0 0 80 80" aria-hidden="true"><path d="M23 65V41c0-9 11-9 11 0V13c0-9 12-9 12 0v27c0-8 10-8 11 0 0-7 10-7 11 1v18c0 9-8 14-17 14H34c-6 0-11-2-11-8Z" fill="#f4c47b" stroke="#72502e" strokeWidth="3" strokeLinejoin="round" /><path d="M23 51c-12-11-17-2-12 4l15 15M46 42v12M57 42v12M30 67h27" fill="none" stroke="#a47b48" strokeWidth="3" strokeLinecap="round" /><path d="M37 13h5" stroke="#fff1c5" strokeWidth="3" strokeLinecap="round" /></svg>;
  const angry = kind === 'angry';
  return <svg className={className} viewBox="0 0 80 80" aria-hidden="true"><circle cx="40" cy="40" r="33" fill={angry ? '#eb8e63' : '#f3cc68'} stroke="#8f672e" strokeWidth="2.5" /><path d="M17 29a26 26 0 0 1 30-16" fill="none" stroke="#fff5bc" strokeWidth="4" strokeLinecap="round" opacity=".7" />
    {kind === 'laugh' ? <><path d="m20 34 11-6-1 11m30-5-11-6 1 11" fill="none" stroke="#413426" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" /><path d="M23 45q17 32 34 0Z" fill="#61362b" /><path d="M30 47h20l-3 7H33Z" fill="#fff7df" /><path d="M15 34c-14 14-4 20 2 12M65 34c14 14 4 20-2 12" fill="#83cbdc" stroke="#4d929f" strokeWidth="1.5" /></> : <><ellipse cx="28" cy="34" rx="3.8" ry="5" fill="#413426" /><ellipse cx="52" cy="34" rx="3.8" ry="5" fill="#413426" />{angry ? <><path d="m20 23 14 7m26-7-14 7M28 58q12-13 24 0" fill="none" stroke="#53372b" strokeWidth="4" strokeLinecap="round" /></> : kind === 'cry' ? <><path d="m20 25 12-4m28 4-12-4M28 59q12-12 24 0" fill="none" stroke="#53372b" strokeWidth="3.5" strokeLinecap="round" /><path d="M22 39c-12 17 2 22 6 11Z" fill="#83cbdc" stroke="#4d929f" strokeWidth="1.5" /></> : <path d="M23 48q17 23 34 0" fill="none" stroke="#53372b" strokeWidth="4" strokeLinecap="round" />}</>}
  </svg>;
}
