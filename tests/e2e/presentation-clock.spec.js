import { test, expect } from '@playwright/test';
import { build } from 'esbuild';

test('the actual presentation hook keeps its frame when wall time jumps behind stale React state', async ({ page }) => {
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(), loader: 'jsx',
      contents: `
        import React, { useState } from 'react';
        import { createRoot } from 'react-dom/client';
        import { flushSync } from 'react-dom';
        import { usePresentation } from './src/presentation.jsx';
        let wall = 10000, monotonic = 1000, rerender;
        Date.now = () => wall;
        Object.defineProperty(performance, 'now', { configurable: true, value: () => monotonic });
        // Freeze the hook's frame-trigger state at its pre-adjustment wall time.
        window.requestAnimationFrame = () => 1;
        window.cancelAnimationFrame = () => {};
        const room = {
          code: 'CLOCK', serverNow: 10000, clientReceivedAt: 10000,
          game: { players: [{ id: 'a', position: 3 }], dice: [1, 2] },
          presentation: { id: 'roll', playerId: 'a', startedAt: 10000, rollEndsAt: 11500, endsAt: 12200, dice: [1, 2],
            moves: [{ playerId: 'a', from: 0, to: 3, path: [1, 2, 3], startedAt: 11500, endsAt: 11920 }] }
        };
        function Probe() {
          const [, force] = useState(0);
          rerender = () => force(value => value + 1);
          const sample = usePresentation(room);
          window.clockFrame = { serverTime: sample.serverTime, active: sample.active, stage: sample.stage, position: sample.positions.a };
          return null;
        }
        flushSync(() => createRoot(document.getElementById('root')).render(<Probe />));
        window.shiftClock = delta => { wall += delta; flushSync(rerender); return window.clockFrame; };
      `,
    },
    bundle: true, write: false, format: 'iife', define: { 'process.env.NODE_ENV': '"production"' },
  });
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const before = await page.evaluate(() => window.clockFrame);
  expect(before).toEqual({ serverTime: 10000, active: true, stage: 'rolling', position: 0 });
  expect(await page.evaluate(() => window.shiftClock(-60000))).toEqual(before);
  expect(await page.evaluate(() => window.shiftClock(120000))).toEqual(before);
});
