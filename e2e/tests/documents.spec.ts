import { test, expect } from '../support/fixtures';
import { uniq } from '../support/env';
import path from 'node:path';

test.describe('Bibliothèque Documents (admin)', () => {
  test('dossier : création, dépôt, recherche, visualisation, téléchargement', async ({ page }) => {
    const folder = uniq('Dossier');
    await page.goto('/documents');
    await page.getByRole('button', { name: 'Nouveau dossier' }).click();
    const modal = page.locator('div.fixed');
    await modal.getByRole('button', { name: 'Créer le dossier' }).click();
    await expect(modal.getByText('Le nom est requis')).toBeVisible();
    await modal.getByLabel('Nom du dossier').fill(folder);
    await modal.getByRole('button', { name: 'Créer le dossier' }).click();

    await page.goto('/documents');
    await page.getByPlaceholder('Rechercher un dossier…').fill(folder);
    const card = page.getByRole('link', { name: new RegExp(folder) });
    await expect(card).toContainText('0 document');
    await card.click();
    await expect(page).toHaveURL(/\/documents\/[0-9a-f-]+$/);
    await expect(page.getByText('Aucun document.')).toBeVisible();

    await page.locator('input[type=file]').setInputFiles(path.join(__dirname, '..', 'fixtures', 'note.txt'));
    await expect(page.getByText('note.txt')).toBeVisible();
    await page.locator('input[type=file]').setInputFiles(path.join(__dirname, '..', 'fixtures', 'data.csv'));
    await expect(page.getByText('data.csv')).toBeVisible();

    await page.getByPlaceholder('Rechercher un fichier…').fill('data');
    await expect(page.getByText('note.txt')).toHaveCount(0);
    await expect(page.getByText('data.csv')).toBeVisible();
    await page.getByPlaceholder('Rechercher un fichier…').fill('');

    const row = page.locator('li', { hasText: 'note.txt' });
    const download = page.waitForEvent('download');
    await row.getByRole('button', { name: 'Télécharger' }).click();
    expect((await download).suggestedFilename()).toBe('note.txt');

    const popup = page.waitForEvent('popup');
    await row.getByRole('button', { name: 'Visualiser' }).click();
    const tab = await popup;
    await expect(tab.locator('body')).toContainText('Pièce jointe de test E2E');
    await tab.close();

    await page.goto('/documents');
    await page.getByPlaceholder('Rechercher un dossier…').fill(folder);
    await expect(page.getByRole('link', { name: new RegExp(folder) })).toContainText('2 documents');
  });

  test('un dossier peut être joint à un processus', async ({ page, api }) => {
    const { folder } = await api.call('admin', 'POST', '/library/folders', { name: uniq('Annexe') });
    const name = uniq('AvecAnnexe');
    await page.goto('/processes');
    await page.getByRole('button', { name: 'Nouveau processus' }).click();
    const modal = page.locator('div.fixed');
    await modal.getByLabel('Nom du processus').fill(name);
    await modal.getByLabel('Pièce jointe (facultatif)').selectOption('folder');
    await modal.getByLabel('Dossier à attacher').selectOption(folder.id);
    await modal.getByRole('button', { name: 'Créer le processus' }).click();
    await expect(page).toHaveURL(/\/processes\/[0-9a-f-]+$/);
    await page.goto('/processes');
    await page.getByPlaceholder('Rechercher un processus').fill(name);
    await page.getByRole('row', { name: new RegExp(name) }).getByRole('link', { name: folder.name }).click();
    await expect(page).toHaveURL(new RegExp(`/documents/${folder.id}$`));
  });
});
