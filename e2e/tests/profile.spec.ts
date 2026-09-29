import { test, expect, openWithLogin } from '../support/fixtures';
import { API_URL, RUN_ID, uniq } from '../support/env';
import { createProcess, startInstance } from '../support/process';

const PASSWORD = 'Jetable123!';

async function createDisposableUser(api: any, roleNames = ['OPERATOR']) {
  const email = `e2e-${RUN_ID}-${Math.random().toString(36).slice(2, 7)}@example.com`;
  const { user } = await api.call('admin', 'POST', '/admin/users', {
    email,
    password: PASSWORD,
    firstName: 'Jetable',
    lastName: `E2E ${RUN_ID}`,
    roleNames,
  });
  return { id: user.id as string, email };
}

test.describe('Mon profil', () => {
  test('informations, préférence email, avatar, mot de passe', async ({ browser, api }) => {
    const u = await createDisposableUser(api);
    const page = await openWithLogin(browser, u.email, PASSWORD);
    await page.goto('/profile');
    await expect(page.getByRole('heading', { level: 1, name: 'Mon profil' })).toBeVisible();

    const info = page.locator('form', { has: page.getByLabel('Prénom') });
    await info.getByLabel('Prénom').fill('Camille');
    await info.getByLabel('Téléphone').fill('+33 1 23 45 67 89');
    await info.getByLabel(/Recevoir les notifications de workflow par email/).uncheck();
    await info.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(info.getByText('Enregistré')).toBeVisible();
    // L'en-tête reflète immédiatement le nouveau prénom.
    await expect(page.getByRole('button', { name: /Camille/ })).toContainText('Camille');

    await page.reload();
    await expect(info.getByLabel('Prénom')).toHaveValue('Camille');
    await expect(info.getByLabel(/Recevoir les notifications/)).not.toBeChecked();

    // Avatar : une image acceptée, un type refusé.
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    );
    await page.locator('input[type=file]').setInputFiles({ name: 'avatar.png', mimeType: 'image/png', buffer: png });
    await expect(page.locator('header img[src*="avatar"], header img[src^="/uploads"], header img').first()).toBeVisible();
    await page.locator('input[type=file]').setInputFiles({ name: 'x.gif', mimeType: 'image/gif', buffer: Buffer.from('GIF89a') });
    await expect(page.locator('p.text-rose-600')).toContainText('non autorisé');

    // Mot de passe : mauvais mot de passe actuel refusé, puis changement réel.
    const pw = page.locator('form', { has: page.getByLabel('Mot de passe actuel') });
    await pw.getByLabel('Mot de passe actuel').fill('pas-le-bon');
    await pw.getByLabel('Nouveau mot de passe (8 caractères min.)').fill('NouveauJetable1!');
    await pw.getByRole('button', { name: 'Mettre à jour' }).click();
    await expect(pw.locator('p.text-rose-700')).toBeVisible();
    await pw.getByLabel('Mot de passe actuel').fill(PASSWORD);
    await pw.getByRole('button', { name: 'Mettre à jour' }).click();
    await expect(pw.getByText('Mot de passe modifié')).toBeVisible();

    const oldLogin = await page.request.post(`${API_URL}/auth/login`, { data: { email: u.email, password: PASSWORD } });
    expect(oldLogin.status()).toBe(401);
    await page.context().close();
  });

  test('délégation : suppléants et période de congé', async ({ browser, api }) => {
    const u = await createDisposableUser(api, ['VALIDATOR']);
    const page = await openWithLogin(browser, u.email, PASSWORD);
    await page.goto('/profile');
    const section = page.locator('form, .card', { has: page.getByText('Mes délégations & congés') }).last();
    const pick = async (label: string, name: RegExp) => {
      const select = section.getByLabel(label);
      const value = await select.locator('option', { hasText: name }).getAttribute('value');
      await select.selectOption(value!);
    };
    await pick('Suppléant 1 (prioritaire)', /Brigitte/);
    await pick('Suppléant 2 (backup secondaire)', /Bernard/);
    await section.getByLabel('Début de congé').fill('2030-01-01');
    await section.getByLabel('Fin de congé').fill('2030-01-15');
    await section.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(section.getByText('Enregistré')).toBeVisible();

    const token = await page.evaluate(() => localStorage.getItem('bpm_token'));
    const res = await page.request.get(`${API_URL}/users/me/delegation`, { headers: { Authorization: `Bearer ${token}` } });
    const { delegation } = await res.json();
    expect(String(delegation.absenceStart)).toContain('2030-01-01');
    expect(delegation.delegateUser1Id).toBeTruthy();

    // Période incohérente : la fin précède le début.
    await section.getByLabel('Fin de congé').fill('2029-12-01');
    await section.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(section.locator('p.text-rose-700')).toBeVisible();
    await page.context().close();
  });
});

test.describe('Notifications', () => {
  test.use({ as: 'operator' });

  test('une nouvelle tâche de pool notifie l\'opérateur ; lecture et filtre', async ({ page, api }) => {
    const proc = await createProcess(api, uniq('Notif'));
    await api.call('operator', 'POST', '/notifications/read-all');
    await startInstance(api, proc.id, uniq('REF-NOTIF'), 'admin');

    await page.goto('/notifications');
    const item = page.locator('.card', { hasText: proc.name }).first();
    await expect(item).toBeVisible();
    await expect(page.locator('header a[href="/notifications"]')).toContainText(/[1-9]/);

    await page.getByLabel('Non lues uniquement').check();
    await expect(page.locator('.card', { hasText: proc.name }).first()).toBeVisible();
    await item.getByRole('button', { name: 'Marquer lu' }).click();
    await expect(page.locator('.card', { hasText: proc.name })).toHaveCount(0);

    await page.getByLabel('Non lues uniquement').uncheck();
    const read = page.locator('.card', { hasText: proc.name }).first();
    await expect(read.getByRole('button', { name: 'Marquer lu' })).toHaveCount(0);
    await read.getByRole('link', { name: 'Ouvrir' }).click();
    await expect(page).toHaveURL(/\/(instances|tasks)/);

    await page.goto('/notifications');
    await page.getByRole('button', { name: 'Tout marquer comme lu' }).click();
    await page.getByLabel('Non lues uniquement').check();
    await expect(page.getByText('Aucune notification non lue.')).toBeVisible();
    const { count } = await api.call('operator', 'GET', '/notifications/unread-count');
    expect(count).toBe(0);
  });
});

test.describe('Tableau de bord', () => {
  test.use({ as: 'operator' });

  test('indicateurs, tâches en attente et activité récente', async ({ page, api }) => {
    const proc = await createProcess(api, uniq('Dashboard'));
    const ref = uniq('REF-DASH');
    await startInstance(api, proc.id, ref);
    const summary = await api.call('operator', 'GET', '/dashboard');

    await page.goto('/dashboard');
    for (const label of ['Instances en cours', 'Mes tâches en attente', 'Processus publiés', 'Clients']) {
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
    }
    await expect(page.getByText(String(summary.kpis.myPendingTasks), { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Répartition des instances')).toBeVisible();
    await expect(page.getByText('Instances démarrées (8 dernières semaines)')).toBeVisible();
    await expect(page.getByText(`Instance démarrée : ${proc.name}`).first()).toBeVisible();
    await page.getByRole('link', { name: 'Voir tout' }).click();
    await expect(page).toHaveURL(/\/tasks$/);
  });
});
