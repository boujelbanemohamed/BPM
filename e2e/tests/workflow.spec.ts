import { test, expect, createApi, openAs } from '../support/fixtures';
import { uniq } from '../support/env';
import { createProcess, CreatedProcess, pendingTaskOf, startInstance } from '../support/process';
import path from 'node:path';

let proc: CreatedProcess;

test.beforeAll(async () => {
  const { api, dispose } = await createApi();
  proc = await createProcess(api, uniq('Workflow'));
  await dispose();
});

test.describe('Workflow complet (opérateur → valideur)', () => {
  test.use({ as: 'operator' });

  test('démarrage avec formulaire, saisie, validation, fin « Terminée »', async ({ page, browser, api }) => {
    const ref = uniq('REF-OK');

    // 1. L'opérateur démarre le processus depuis la liste.
    await page.goto('/processes');
    await page.getByPlaceholder('Rechercher un processus').fill(proc.name);
    const row = page.getByRole('row', { name: new RegExp(proc.name) });
    await row.getByRole('button', { name: 'Démarrer' }).click();
    await expect(page.getByRole('heading', { name: `Démarrer : ${proc.name}` })).toBeVisible();

    // Le champ obligatoire est contrôlé côté client.
    await page.getByRole('button', { name: "Démarrer l'instance" }).click();
    await expect(page.getByText('Le champ "Référence dossier" est obligatoire')).toBeVisible();

    await page.getByLabel('Référence dossier *').fill(ref);
    await page.getByRole('button', { name: "Démarrer l'instance" }).click();
    await expect(page).toHaveURL(/\/instances\/[0-9a-f-]+$/);
    const instanceId = page.url().split('/').pop()!;
    await expect(page.getByRole('heading', { level: 1, name: proc.name })).toBeVisible();
    await expect(page.getByText('En cours', { exact: true }).first()).toBeVisible();
    await expect(page.getByText(ref)).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Saisie E2E' })).toBeVisible();

    // 2. Mes tâches : recherche par référence puis saisie.
    await page.getByRole('link', { name: 'Mes tâches' }).click();
    await page.getByPlaceholder('Rechercher une tâche').fill(ref);
    const card = page.locator('.card', { hasText: ref });
    await expect(card).toHaveCount(1);
    await card.getByRole('button', { name: 'Traiter' }).click();
    await card.getByRole('button', { name: 'Valider la tâche' }).click();
    await expect(card.getByText('Le champ "Montant" est obligatoire')).toBeVisible();
    await card.getByLabel('Montant *').fill('1250');
    await card.getByLabel('Note').fill('Ligne 1\nLigne 2');
    await card.getByRole('button', { name: 'Valider la tâche' }).click();
    await expect(page.locator('.card', { hasText: ref })).toHaveCount(0);

    // L'opérateur ne peut pas traiter l'étape du valideur.
    const validatorTask = await pendingTaskOf(api, 'validator', instanceId);
    expect(validatorTask?.step_name).toBe('Validation E2E');
    expect(await api.status('operator', 'POST', `/tasks/${validatorTask.id}/complete`, { formData: { approved: true } })).toBe(403);

    // 3. Le valideur approuve dans son propre onglet.
    const vPage = await openAs(browser, 'validator');
    await vPage.goto('/tasks');
    await vPage.getByPlaceholder('Rechercher une tâche').fill(ref);
    const vCard = vPage.locator('.card', { hasText: ref });
    await expect(vCard).toContainText('Validation E2E');
    await expect(vCard).toContainText('amount : 1250');
    await vCard.getByRole('button', { name: 'Traiter' }).click();
    await vCard.getByLabel('Approuvé ? *').selectOption('true');
    await vCard.getByRole('button', { name: 'Valider la tâche' }).click();
    await expect(vPage.locator('.card', { hasText: ref })).toHaveCount(0);
    await vPage.context().close();

    // 4. L'instance est terminée et l'historique est complet.
    await page.goto(`/instances/${instanceId}`);
    await expect(page.getByText('Terminée', { exact: true }).first()).toBeVisible();
    const history = page.locator('.card', { hasText: 'Historique / traçabilité' });
    await expect(history).toContainText('Instance démarrée');
    await expect(history).toContainText('Passerelle évaluée');
    await expect(history).toContainText('Processus terminé');

    // Une tâche déjà traitée ne peut pas l'être une seconde fois.
    expect(await api.status('validator', 'POST', `/tasks/${validatorTask.id}/complete`, { formData: { approved: false } })).toBe(409);
  });

  test('rejet : la passerelle emprunte le flux par défaut', async ({ api }) => {
    const instanceId = await startInstance(api, proc.id, uniq('REF-KO'));
    const t1 = await pendingTaskOf(api, 'operator', instanceId);
    await api.call('operator', 'POST', `/tasks/${t1.id}/complete`, { formData: { amount: 10 } });
    const t2 = await pendingTaskOf(api, 'validator', instanceId);
    await api.call('validator', 'POST', `/tasks/${t2.id}/complete`, { formData: { approved: false } });
    const { instance, events } = await api.call('operator', 'GET', `/instances/${instanceId}`);
    expect(instance.status).toBe('COMPLETED');
    expect(events.find((e: any) => e.action === 'PROCESS_COMPLETED')?.details.endEvent).toBe('Rejeté');
  });

  test('le serveur refuse une tâche sans champ obligatoire', async ({ api }) => {
    const instanceId = await startInstance(api, proc.id, uniq('REF-REQ'));
    const t1 = await pendingTaskOf(api, 'operator', instanceId);
    expect(await api.status('operator', 'POST', `/tasks/${t1.id}/complete`, { formData: {} })).toBe(400);
    expect(await api.status('operator', 'POST', `/instances/processes/${proc.id}/start`, { formData: {} })).toBe(400);
  });

  test('commentaires : général et rattaché à une tâche', async ({ page, api }) => {
    const instanceId = await startInstance(api, proc.id, uniq('REF-COM'));
    await page.goto(`/instances/${instanceId}`);
    const discussion = page.locator('.card', { hasText: 'Discussion' });
    await expect(discussion).toContainText('Aucun commentaire pour l\'instant.');
    await expect(discussion.getByRole('button', { name: 'Envoyer' })).toBeDisabled();

    await discussion.getByPlaceholder('Écrire un commentaire…').fill('Premier commentaire E2E');
    await discussion.getByRole('button', { name: 'Envoyer' }).click();
    await expect(discussion).toContainText('Premier commentaire E2E');
    await expect(discussion).toContainText('Olivier Opérateur');

    await discussion.getByPlaceholder('Écrire un commentaire…').fill('<img src=x onerror="window.__xss=1">');
    await discussion.locator('select').selectOption({ label: 'Sur la tâche : Saisie E2E' });
    await discussion.getByRole('button', { name: 'Envoyer' }).click();
    const item = discussion.locator('li', { hasText: '<img src=x' });
    await expect(item).toContainText('Saisie E2E');
    // Le contenu est rendu comme du texte, jamais interprété.
    expect(await page.evaluate(() => (window as any).__xss)).toBeUndefined();
  });

  test('documents joints : dépôt, liste, téléchargement, type refusé', async ({ page, api }) => {
    const instanceId = await startInstance(api, proc.id, uniq('REF-DOC'));
    await page.goto(`/instances/${instanceId}`);
    const docs = page.locator('.card', { hasText: 'Documents joints' });
    await expect(docs).toContainText('Aucun document.');

    await docs.locator('input[type=file]').setInputFiles(path.join(__dirname, '..', 'fixtures', 'note.txt'));
    await expect(docs).toContainText('note.txt');

    const download = page.waitForEvent('download');
    await docs.getByRole('button', { name: 'Télécharger' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe('note.txt');

    const popup = page.waitForEvent('popup');
    await docs.getByRole('button', { name: 'Visualiser' }).click();
    const tab = await popup;
    await expect(tab.locator('body')).toContainText('Pièce jointe de test E2E');
    await tab.close();

    await docs.locator('input[type=file]').setInputFiles({ name: 'script.exe', mimeType: 'application/x-msdownload', buffer: Buffer.from('MZ') });
    await expect(page.getByText(/Type de fichier non autorisé/)).toBeVisible();

    await expect(page.locator('.card', { hasText: 'Historique' })).toContainText('Document déposé');
  });

  test('téléchargement après expiration du jeton d\'accès (refresh transparent)', async ({ page, api }) => {
    const instanceId = await startInstance(api, proc.id, uniq('REF-EXP'));
    await page.goto(`/instances/${instanceId}`);
    const docs = page.locator('.card', { hasText: 'Documents joints' });
    await docs.locator('input[type=file]').setInputFiles(path.join(__dirname, '..', 'fixtures', 'note.txt'));
    await expect(docs).toContainText('note.txt');

    // Simule un jeton d'accès expiré (le refresh token reste valide).
    await page.evaluate(() => localStorage.setItem('bpm_token', 'expire.invalide.jeton'));
    page.on('dialog', (d) => d.dismiss());
    const download = page.waitForEvent('download', { timeout: 5000 });
    await docs.getByRole('button', { name: 'Télécharger' }).click();
    expect((await download).suggestedFilename()).toBe('note.txt');
  });
});

test.describe('Liste des instances', () => {
  test.use({ as: 'admin' });

  test('filtres statut/processus et export CSV', async ({ page, api }) => {
    const ref = uniq('REF-LIST');
    await startInstance(api, proc.id, ref, 'admin');
    await page.goto('/instances');
    await page.locator('select').nth(1).selectOption({ label: proc.name });
    await expect(page.getByRole('row', { name: new RegExp(ref) })).toBeVisible();
    const rows = page.locator('tbody tr');
    await expect(rows.first()).toContainText(proc.name);

    await page.locator('select').nth(0).selectOption({ label: 'Terminée' });
    await expect(page.getByRole('row', { name: new RegExp(ref) })).toHaveCount(0);
    await page.locator('select').nth(0).selectOption({ label: 'En cours' });
    await expect(page.getByRole('row', { name: new RegExp(ref) })).toBeVisible();

    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Exporter CSV' }).click();
    const csv = await download;
    const text = Buffer.concat(await (await csv.createReadStream()).toArray()).toString('utf8');
    expect(text.split('\r\n')[0]).toContain('Données du dossier');
    const line = text.split('\r\n').find((l) => l.includes(ref));
    expect(line).toContain('En cours');

    await page.getByRole('row', { name: new RegExp(ref) }).getByRole('button', { name: 'Voir' }).click();
    await expect(page).toHaveURL(/\/instances\/[0-9a-f-]+$/);
  });
});
