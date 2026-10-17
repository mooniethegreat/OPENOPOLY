import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const recoveryHtml = await readFile(new URL('../../public/recover-seat.html', import.meta.url), 'utf8');
const token = 'A'.repeat(43); // Synthetic fixture credential; never accesses a saved room.
const origin = 'http://seat-recovery.test';

test('a verified recovery link restores only its authenticated seat and retains other saved tables', async ({ page }) => {
  const other = { roomCode: 'OTHER2', playerId: 'other-seat', sessionToken: 'other-fixture-token' };
  const legacy = { roomCode: 'LEGAC2', playerId: 'legacy-seat', sessionToken: 'legacy-fixture-token' };
  await page.addInitScript(({ other, legacy }) => {
    if (!sessionStorage.getItem('seat-fixture-initialized')) {
      localStorage.setItem('monopoly-table-sessions-v2', JSON.stringify({ OTHER2: other }));
      localStorage.setItem('monopoly-table-session-v1', JSON.stringify(legacy));
      sessionStorage.setItem('seat-fixture-initialized', '1');
    }
  }, { other, legacy });
  let authorization, requestFragment;
  await page.route(`${origin}/**`, async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname === '/api/rooms/ABC234') {
      authorization = request.headers().authorization;
      requestFragment = await page.evaluate(() => location.hash);
      return route.fulfill({ json: { room: { code: 'ABC234', theme: 'inland-empire', players: [{ id: 'verified-seat', name: 'Verified player' }] }, playerId: 'verified-seat' } });
    }
    return route.fulfill({ contentType: 'text/html', body: url.pathname === '/recover-seat.html' ? recoveryHtml : '<title>Recovered table fixture</title>' });
  });
  await page.goto(`${origin}/recover-seat.html#room=ABC234&token=${token}`);
  await expect(page).toHaveURL(`${origin}/?room=ABC234`);
  expect(authorization).toBe(`Bearer ${token}`);
  expect(requestFragment).toBe('');
  const saved = await page.evaluate(() => ({ sessions: JSON.parse(localStorage.getItem('monopoly-table-sessions-v2')), active: localStorage.getItem('monopoly-table-active-v2'), legacy: localStorage.getItem('monopoly-table-session-v1') }));
  expect(saved.sessions.ABC234).toEqual({ roomCode: 'ABC234', playerId: 'verified-seat', sessionToken: token, name: 'Verified player', theme: 'inland-empire' });
  expect(saved.sessions.OTHER2).toEqual(other);
  expect(saved.sessions.LEGAC2).toEqual(legacy);
  expect(saved.active).toBe('ABC234');
  expect(saved.legacy).toBeNull();
});

test('a rejected recovery credential saves no seat and leaves no credential in the address bar', async ({ page }) => {
  await page.route(`${origin}/**`, route => new URL(route.request().url()).pathname.startsWith('/api/') ? route.fulfill({ status: 401, json: { error: 'Invalid fixture credential' } }) : route.fulfill({ contentType: 'text/html', body: recoveryHtml }));
  await page.goto(`${origin}/recover-seat.html#room=ABC234&token=${token}`);
  await expect(page.getByRole('heading')).toHaveText('Seat recovery needs attention');
  await expect(page).toHaveURL(`${origin}/recover-seat.html`);
  expect(await page.evaluate(() => localStorage.getItem('monopoly-table-sessions-v2'))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem('monopoly-table-active-v2'))).toBeNull();
});
