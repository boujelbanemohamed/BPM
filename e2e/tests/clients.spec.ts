import { test, expect } from '../support/fixtures';
import { uniq } from '../support/env';
import { createProcess } from '../support/process';

test.describe('Clients', () => {
  test.use({ as: 'operator' });

  test('création, recherche, fiche, modification, export CSV', async ({ page }) => {
    const name = uniq('Client');
    await page.goto('/clients');
    await page.getByRole('button', { name: 'Nouveau client' }).click();
    await page.getByRole('button', { name: 'Créer', exact: true }).click();
    await expect(page.getByText('Le nom est obligatoire')).toBeVisible();

    await page.getByPlaceholder('Nom *').fill(name);
    await page.getByPlaceholder('Email', { exact: true }).fill('contact-e2e@example.com');
    await page.getByPlaceholder('Téléphone', { exact: true }).fill('+33 6 12 34 56 78');
    await page.getByRole('button', { name: 'Créer', exact: true }).click();

    await page.getByPlaceholder('Rechercher un client…').fill(name);
    const row = page.getByRole('row', { name: new RegExp(name) });
    await expect(row).toContainText('contact-e2e@example.com');
    await expect(row).toContainText('+33 6 12 34 56 78');

    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Exporter CSV' }).click();
    const csv = Buffer.concat(await (await (await download).createReadStream()).toArray()).toString('utf8');
    expect(csv).toContain(name);
    expect(csv).toContain('+33 6 12 34 56 78');

    await row.getByRole('button', { name: 'Voir' }).click();
    await expect(page).toHaveURL(/\/clients\/[0-9a-f-]+$/);
    await expect(page.getByText('Aucun dossier pour ce client.')).toBeVisible();
    await page.getByLabel('Adresse').fill('1 rue du Test, Paris');
    await page.getByLabel('Notes').fill('Client créé par la suite E2E');
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByText('Enregistré')).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Adresse')).toHaveValue('1 rue du Test, Paris');
  });

  test('champ « client » au démarrage : sélection, création à la volée, dossier lié', async ({ page, api }) => {
    const proc = await createProcess(api, uniq('AvecClient'), true, { clientField: true });
    const clientName = uniq('Nouveau client picker');
    const ref = uniq('REF-CLI');

    await page.goto('/processes');
    await page.getByPlaceholder('Rechercher un processus').fill(proc.name);
    await page.getByRole('row', { name: new RegExp(proc.name) }).getByRole('button', { name: 'Démarrer' }).click();
    const modal = page.locator('div.fixed');
    await modal.getByLabel('Référence dossier *').fill(ref);
    await expect(modal.getByText('Aucun client sélectionné')).toBeVisible();
    await modal.getByPlaceholder('Rechercher un client…').click();
    await modal.getByPlaceholder('Rechercher un client…').fill(clientName);
    await modal.getByRole('button', { name: `+ Nouveau client « ${clientName} »` }).click();
    await modal.getByRole('button', { name: 'Créer et sélectionner' }).click();
    await expect(modal.getByPlaceholder('Rechercher un client…')).toHaveValue(clientName);
    await modal.getByRole('button', { name: "Démarrer l'instance" }).click();

    await expect(page).toHaveURL(/\/instances\/[0-9a-f-]+$/);
    await expect(page.getByText(clientName)).toBeVisible();
    await page.getByRole('link', { name: 'Fiche client' }).click();
    await expect(page).toHaveURL(/\/clients\/[0-9a-f-]+$/);
    await expect(page.getByRole('heading', { name: 'Processus liés (1)' })).toBeVisible();
    await expect(page.getByRole('row', { name: new RegExp(proc.name) })).toContainText('En cours');
  });

  test('un identifiant de client invalide est refusé proprement (400, pas 500)', async ({ api }) => {
    const proc = await createProcess(api, uniq('ClientInvalide'), true, { clientField: true });
    const status = await api.status('operator', 'POST', `/instances/processes/${proc.id}/start`, {
      formData: { ref: 'x', client: 'pas-un-uuid' },
    });
    expect(status).toBe(400);
    expect(await api.status('operator', 'GET', '/clients/pas-un-uuid')).toBe(400);
  });
});
