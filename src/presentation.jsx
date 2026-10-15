import { useEffect, useMemo, useRef, useState } from 'react';
import { samplePresentation, synchronizeClock, rebaseClockAfterJump } from './presentation-state.js';
export { samplePresentation } from './presentation-state.js';

export function usePresentation(room) {
  const [, setNow] = useState(Date.now);
  const [reducedMotion, setReducedMotion] = useState(() => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  const clock = useRef({ stamp: null, offset: 0 });
  const clockWatch = useRef({ wall: Date.now(), monotonic: performance.now() });
  // Use the receipt time once for each snapshot. A render must not keep resetting the clock.
  const wallTime = Date.now(), monotonicTime = performance.now();
  clock.current = rebaseClockAfterJump(clock.current, clockWatch.current, wallTime, monotonicTime);
  clockWatch.current = { wall: wallTime, monotonic: monotonicTime };
  clock.current = synchronizeClock(clock.current, room);
  const serverTime = wallTime + clock.current.offset;
  const endAt = room?.presentation?.endsAt || 0;

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(query.matches);
    update(); query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (!endAt || endAt <= Date.now() + clock.current.offset) { setNow(Date.now()); return; }
    let frame, last = 0;
    const tick = stamp => {
      if (stamp - last > 25) { setNow(Date.now()); last = stamp; }
      if (Date.now() + clock.current.offset < endAt) frame = requestAnimationFrame(tick);
      else setNow(Date.now());
    };
    frame = requestAnimationFrame(tick);
    const resync = () => setNow(Date.now());
    document.addEventListener('visibilitychange', resync);
    return () => { cancelAnimationFrame(frame); document.removeEventListener('visibilitychange', resync); };
  }, [endAt, room?.presentation?.id]);

  const clockOffset = clock.current.offset;
  return useMemo(() => ({ ...samplePresentation(room, serverTime, reducedMotion), clockOffset }), [room, serverTime, reducedMotion, clockOffset]);
}
