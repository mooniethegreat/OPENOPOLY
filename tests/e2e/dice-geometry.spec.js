import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import fs from 'node:fs/promises';

test('rendered dice clear the table at every sampled tumble and settle with all six correct top faces', async ({ page }, testInfo) => {
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: 'jsx', contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { flushSync } from 'react-dom';
      import { Dice } from './src/Board.jsx';
      const root = createRoot(document.getElementById('root'));
      window.renderDice = (angle, progress, rolling) => flushSync(() => root.render(
        <div className="fixture-world" style={{ transform: 'rotateX(' + angle + 'deg)' }}>
          <div className="fixture-floor" />
          {[1,2,3,4,5,6].map((value,index) => <div key={value} className="fixture-piece" style={{ left: 100 + index % 3 * 250, top: 125 + Math.floor(index / 3) * 220 }}>
            <Dice value={value} index={index % 2} size={62} grounded rolling={rolling} progress={progress} />
            <span className="fixture-label">{value}</span>
          </div>)}
        </div>
      ));
    ` },
    bundle: true, write: false, format: 'iife', loader: { '.css': 'empty' }, define: { 'process.env.NODE_ENV': '"production"' },
  });
  await page.setViewportSize({ width: 1100, height: 700 });
  await page.setContent('<div id="root"></div>');
  await page.addStyleTag({ content: await fs.readFile('src/board-scene.css', 'utf8') + `
    body{margin:0;background:#152d24;font-family:Arial,sans-serif}#root{width:1100px;height:700px;perspective:1800px;display:grid;place-items:center}
    .fixture-world{position:relative;width:850px;height:550px;transform-style:preserve-3d}
    .fixture-floor{position:absolute;inset:0;background:#a8b895;border:8px solid #49634a;box-shadow:0 12px 0 #294832}
    .fixture-piece{position:absolute;width:62px;height:62px;transform-style:preserve-3d}
    .fixture-label{position:absolute;top:95px;left:21px;font-weight:bold;font-size:22px;color:#284b38}
  ` });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  for (const angle of [0, 48]) {
    for (const progress of [0, .05, .17, .34, .58, .79, .95, 1]) {
      await page.evaluate(({ angle, progress }) => window.renderDice(angle, progress, true), { angle, progress });
      const minima = await page.locator('.physical-die-cube').evaluateAll(cubes => cubes.map(cube => {
        const matrix = new DOMMatrix(getComputedStyle(cube).transform);
        const half = parseFloat(getComputedStyle(cube.parentElement).width) / 2;
        const heights = [];
        for (const x of [-half, half]) for (const y of [-half, half]) for (const z of [-half, half]) heights.push(new DOMPoint(x, y, z).matrixTransform(matrix).z);
        return Math.min(...heights);
      }));
      expect(Math.min(...minima), `camera ${angle}, tumble ${progress}`).toBeGreaterThan(.99);
      if (angle === 48 && progress === .34) await page.screenshot({ path: testInfo.outputPath('dice-tumble-48.png') });
    }
    await page.evaluate(angle => window.renderDice(angle, 1, false), angle);
    const normals = await page.locator('.physical-die').evaluateAll(dice => dice.map(die => {
      const value = Number(die.dataset.value);
      const cube = die.querySelector('.physical-die-cube');
      const face = die.querySelector('.die-face-' + value);
      const normal = new DOMPoint(0, 0, 1, 0).matrixTransform(new DOMMatrix(getComputedStyle(cube).transform).multiply(new DOMMatrix(getComputedStyle(face).transform)));
      return { value, x: normal.x, y: normal.y, z: normal.z, perspective: getComputedStyle(die).perspective };
    }));
    for (const normal of normals) {
      expect(normal.perspective).toBe('none');
      expect(Math.abs(normal.x)).toBeLessThan(.00001);
      expect(Math.abs(normal.y)).toBeLessThan(.00001);
      expect(normal.z).toBeCloseTo(1, 5);
    }
    await page.screenshot({ path: testInfo.outputPath('dice-rest-' + angle + '.png') });
  }
});
