export async function openGameDrawer(page, name) {
  const desktopTab = page.getByRole('tab', { name: new RegExp(`^${name}`) });
  if (await desktopTab.isVisible()) await desktopTab.click();
  else if (name === 'Players') await page.getByTestId('players-toggle').click();
  else if (name === 'Chat') await page.getByRole('button', { name: /^Chat(?: \(\d+\))?$/ }).click();
  else {
    await page.getByRole('button', { name: 'Open game tools', exact: true }).click();
    await page.getByRole('button', { name: name === 'Properties' ? 'Properties & cards' : new RegExp(`^${name}(?:$| )`) }).click();
  }
  return page.getByTestId('game-drawer');
}

export async function openGameComposer(page, name) {
  const button = page.getByRole('button', { name, exact: true });
  if (!await button.isVisible()) await page.getByRole('button', { name: 'Open game tools', exact: true }).click();
  await page.getByRole('button', { name, exact: true }).click();
}

export async function showCameraControls(page) {
  const trigger = page.getByRole('button', { name: 'Board camera controls', exact: true });
  if (await trigger.isVisible() && await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click();
}
