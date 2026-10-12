import { expect, test } from '@playwright/test';
import { allowSimulation, pinDemoData, raiseSheet } from './demo.ts';

// Wednesday 7 Oct 2026, 09:00 in Madeira. Demo data: its timetable never changes.
test.beforeEach(async ({ page }) => {
  await pinDemoData(page);
  await page.clock.setFixedTime(new Date('2026-10-07T08:00:00Z'));
});

test('by bus, or on foot or by bike beside it, as in a maps app', async ({ page }) => {
  await allowSimulation(page);
  await page.goto('./');
  await raiseSheet(page);
  await page.getByRole('combobox', { name: 'Куди' }).fill('Monte');
  await page.getByRole('option').first().click();
  await page.getByRole('combobox', { name: 'Звідки' }).fill('Funchal (Av');
  await page.getByRole('option').first().click();
  // The row of ways, the bus chosen and its options listed.
  const modes = page.getByRole('group', { name: 'Як їхати' });
  await expect(modes.getByRole('button', { name: /^Автобус: / })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('.it-card').first()).toBeVisible();
  // On foot along the streets: its time, distance and climb, and Google Maps to follow it.
  await modes.getByRole('button', { name: /^Пішки: \d/ }).click();
  await expect(page).toHaveURL(/m=walk/);
  const card = page.locator('.travel--walk');
  await expect(card).toContainText(/\d км/);
  await expect(card.getByRole('link', { name: 'Навігація в Google Maps' })).toHaveAttribute(
    'href',
    /travelmode=walking/,
  );
  await expect(page.locator('.it-card')).toHaveCount(0);
  // By bike, then back to the bus.
  await modes.getByRole('button', { name: /^Велосипед: / }).click();
  await expect(page.locator('.travel--bike')).toBeVisible();
  await modes.getByRole('button', { name: /^Автобус: / }).click();
  await expect(page.locator('.it-card').first()).toBeVisible();
  // On foot again, followed in the app, turn by turn, over the map.
  await modes.getByRole('button', { name: /^Пішки: \d/ }).click();
  await card.getByRole('button', { name: 'Simulate' }).click();
  await expect(page).toHaveURL(/#\/trip/);
  const guide = page.locator('.walk-guide');
  await expect(guide).toContainText('Пішки до «Monte');
  await expect(guide.getByRole('button', { name: 'Голосові підказки' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('.map-wrap .walk-guide')).toBeVisible();
});

test('the hiking trails: by kind and region, each with its buses, on the map', async ({ page }) => {
  await page.goto('./#/hikes');
  await raiseSheet(page);
  await expect(page.getByRole('heading', { name: 'Піші стежки й левади' })).toBeVisible();
  await expect.poll(() => page.locator('.trail-card').count()).toBeGreaterThan(50);
  // The official PR trails only, with their red and yellow plates.
  await page.getByRole('button', { name: 'Офіційні PR' }).click();
  await expect(page.locator('.trail-card .trail-badge--pr').first()).toBeVisible();
  expect(await page.locator('.trail-card').count()).toBe(
    await page.locator('.trail-card .trail-badge--pr').count(),
  );
  // The walk to the tip of the island: its facts, the bus at its start, back the same way.
  await page.locator('.trail-card', { hasText: 'Ponta de São Lourenço' }).click();
  await expect(page).toHaveURL(/#\/hikes\/pr8$/);
  // The sheet down, the whole trail on the map; pulled up, its page.
  await expect(page.locator('.panel--min')).toHaveCount(1);
  await raiseSheet(page);
  await expect(page.locator('.hike__facts')).toContainText('Довжина');
  await expect(page.locator('.hike-stop').first()).toContainText('Початок');
  await expect(page.locator('.hike__back')).toContainText('назад тим самим шляхом');
  // Its photo over its name, and the places with a view on it: a tap shows one on the map.
  await expect(page.locator('.hike__hero img')).toBeVisible();
  const view = page.locator('.hike-view').first();
  await view.click();
  await expect(page.locator('.map-spot__name')).toHaveText(
    (await view.locator('.hike-view__name').textContent())!,
  );
  await expect(page.locator('.hike .destination__credit')).toContainText('Фото:');
  await page.locator('.hike .destination__back').click();
  await expect(page).toHaveURL(/#\/hikes$/);
  // The trails on the map from any screen, by their button.
  await page.getByRole('link', { name: 'Маршрут' }).click();
  const button = page.getByRole('button', { name: 'Піші стежки' });
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  // The settings are a gear at the top now.
  await page.getByRole('link', { name: 'Налаштування' }).click();
  await expect(page).toHaveURL(/#\/settings/);
});

test('another trail met is added to the walk and taken off again', async ({ page }) => {
  // The promenade from Praia Formosa to Câmara de Lobos, walked from Praia Formosa.
  await page.goto('./#/hikes/osm-2232229?rev=1');
  await raiseSheet(page);
  const promenade = page.locator('.hike-branch').first();
  await expect(promenade).toContainText('Passeio Público Marítimo');
  await expect(promenade).toHaveAttribute('aria-pressed', 'false');
  await promenade.click();
  // Asked first whether to merge the two into one walk: only shown here.
  await page.getByRole('button', { name: 'Лише показати' }).click();
  await expect(page).toHaveURL(/add=osm-2223213\.0/);
  await expect(promenade).toHaveAttribute('aria-pressed', 'true');
  // The walk may now start at either trail's start, and is longer.
  await expect(page.locator('.hike__starts .chip')).toHaveCount(2);
  await expect(page.getByText(/Разом із доданими: \d/)).toBeVisible();
  await promenade.click();
  await expect(promenade).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.hike__starts')).toHaveCount(0);
});

test('another trail met is merged with the trail into one walk', async ({ page }) => {
  await page.goto('./#/hikes/osm-2232229?rev=1');
  await raiseSheet(page);
  const length = await page.locator('.hike__facts dd').first().innerText();
  await page.locator('.hike-branch').first().click();
  await expect(page.getByRole('dialog', { name: 'Об’єднати маршрути?' })).toBeVisible();
  await page.getByRole('button', { name: 'Об’єднати маршрути' }).click();
  await expect(page).toHaveURL(/merge=1/);
  await expect(page.locator('.hike__merged')).toBeVisible();
  // One walk now: its length is the two trails' together, its start chips gone.
  await expect(page.locator('.hike__facts dd').first()).not.toHaveText(length);
  await expect(page.locator('.hike__starts')).toHaveCount(0);
  await page.getByRole('button', { name: 'Роз’єднати' }).click();
  await expect(page).not.toHaveURL(/merge=1/);
});

test('where you are can be the end of a trip too', async ({ page }) => {
  await page.goto('./#/plan');
  await raiseSheet(page);
  for (const field of ['.plan__from', '.plan__to']) {
    await expect(
      page.locator(field).getByRole('button', { name: 'Моє місцезнаходження' }),
    ).toBeVisible();
  }
});
