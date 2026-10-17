import React from 'react';
import { ArrowRight, BookOpen, DoorOpen, Layers, ShieldCheck } from 'lucide-react';
import UnoCard from './UnoCard.jsx';

export default function GameChooser({ onChoose, savedRooms = [], onRules }) {
  return <main className="game-chooser" data-testid="game-chooser">
    <section className="chooser-intro"><span className="eyebrow">ONLINE MULTIPLAYER</span><h1>Choose your game.</h1><p>Two games. Private rooms. <br />Play from any device.</p></section>
    <section className="chooser-games" aria-label="Choose a game">
      <button className="chooser-game chooser-monopoly" onClick={() => onChoose('monopoly')} aria-label="Play Openopoly"><span className="chooser-game-number">01 / PROPERTY TRADING</span><div className="chooser-monopoly-art" aria-hidden="true"><span className="chooser-deed"><i /><b>BOARDWALK</b><small>TITLE DEED</small><strong>$400</strong></span><span className="chooser-dice">•••</span><span className="chooser-dice second">••</span></div><div className="chooser-game-copy"><h2>OPENOPOLY</h2><p>Buy, trade and build your property empire.</p><span>Classic & Inland Empire-opoly <ArrowRight size={20} /></span></div></button>
      <button className="chooser-game chooser-uno" onClick={() => onChoose('uno')} aria-label="Play OpenUno"><span className="chooser-game-number">02 / MATCH. PLAY. UNO.</span><div className="chooser-cards" aria-hidden="true"><UnoCard card={{ color: 'red', kind: 'number', value: 7 }} label={false} /><UnoCard card={{ color: 'blue', kind: 'reverse' }} label={false} /><UnoCard card={{ color: 'wild', kind: 'wild-draw-four' }} label={false} /></div><div className="chooser-game-copy"><h2>OPEN<span>UNO</span></h2><p>Match colors and numbers. Be first to go out.</p><span>Classic & Disney Lilo & Stitch <ArrowRight size={20} /></span></div></button>
    </section>
    <footer className="chooser-footer"><span><ShieldCheck size={16} />Private rooms · Saved seats · No account needed</span>{savedRooms.length > 0 && <div className="chooser-saved"><span>YOUR TABLES</span>{savedRooms.map(seat => <a key={seat.roomCode} href={`/?room=${seat.roomCode}${seat.gameType === 'uno' ? '&game=uno' : ''}`}><DoorOpen size={15} /><b>{seat.gameType === 'uno' ? 'OpenUno' : 'Openopoly'}</b><span>{seat.roomCode}</span><ArrowRight size={15} /></a>)}</div>}<button className="text-button" onClick={onRules}><BookOpen size={16} />How to play</button></footer>
  </main>;
}
