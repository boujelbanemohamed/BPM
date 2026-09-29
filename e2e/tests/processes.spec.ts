import { test, expect, openAs } from '../support/fixtures';
import { uniq } from '../support/env';
import { createProcess, pendingTaskOf, startInstance, workflowXml } from '../support/process';

test.describe('Processus (admin)', () => {
  test.beforeEach(async ({ page }) => {
    page.on('dialog', (d) => d.accept());
  });

  test('création via la modale puis conception dans le designer', async ({ page, api }) => {
    const name = uniq('Designer');
    await page.goto('/processes');
    await page.getByRole('button', { name: 'Nouveau processus' }).click();
    const modal = page.locator('div.fixed');
    await modal.getByRole('button', { name: 'Créer le processus' }).click();
    await expect(modal.getByText('Le nom est requis')).toBeVisible();

    await modal.getByLabel('Nom du processus').fill(name);
    await modal.getByRole('button', { name: 'Créer le processus' }).click();
    await expect(page).toHaveURL(/\/processes\/[0-9a-f-]+$/);
    const id = page.url().split('/').pop()!;
    await expect(page.getByRole('heading', { level: 1 })).toContainText(name);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Brouillon');

    // Ajout d'une tâche utilisateur et assignation à un rôle.
    await page.getByRole('button', { name: '+ Tâche utilisateur' }).click();
    await expect(page.getByText('Tâche utilisateur', { exact: true })).toBeVisible();
    await page.getByLabel('Rôle assigné (pool de traitement)').selectOption('OPERATOR');
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByText('Enregistré')).toBeVisible();

    const { process } = await api.call('admin', 'GET', `/processes/${id}`);
    expect(process.bpmn_xml).toContain('Nouvelle tâche');
    expect(process.bpmn_xml).toMatch(/assigneeRole="OPERATOR"/);

    // Un second processus du même nom et de la même version est refusé.
    await page.goto('/processes');
    await page.getByRole('button', { name: 'Nouveau processus' }).click();
    await modal.getByLabel('Nom du processus').fill(name);
    await modal.getByRole('button', { name: 'Créer le processus' }).click();
    await expect(modal.getByText('existe déjà')).toBeVisible();
  });

  test('cycle de vie : publier, dupliquer, comparer, archiver', async ({ page, api }) => {
    const p = await createProcess(api, uniq('Cycle'), false);
    await page.goto('/processes');
    await page.getByPlaceholder('Rechercher un processus').fill(p.name);
    const row = page.getByRole('row', { name: new RegExp(p.name) });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('Brouillon');
    await expect(row.getByRole('button', { name: 'Démarrer' })).toHaveCount(0);

    await row.getByRole('button', { name: 'Publier' }).click();
    await expect(row).toContainText('Publié');
    await expect(row.getByRole('button', { name: 'Démarrer' })).toBeVisible();
    await expect(row.getByRole('button', { name: 'Supprimer' })).toHaveCount(0);

    // Un processus publié est en lecture seule dans le designer.
    await row.getByRole('button', { name: 'Voir' }).click();
    await expect(page.getByText('Ce processus est publié : lecture seule')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Enregistrer' })).toHaveCount(0);
    expect(await api.status('admin', 'PUT', `/processes/${p.id}`, { name: 'modif interdite' })).toBe(409);

    // Duplication = nouvelle version en brouillon.
    await page.goto('/processes');
    await page.getByPlaceholder('Rechercher un processus').fill(p.name);
    await row.getByRole('button', { name: 'Dupliquer' }).click();
    await expect(page).toHaveURL(/\/processes\/[0-9a-f-]+$/);
    const v2Id = page.url().split('/').pop()!;
    expect(v2Id).not.toBe(p.id);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Brouillon');
    await api.call('admin', 'POST', `/processes/${v2Id}/publish`);

    // Comparaison des deux versions publiées.
    await page.goto('/processes');
    await page.getByPlaceholder('Rechercher un processus').fill(p.name);
    const rows = page.getByRole('row', { name: new RegExp(p.name) });
    await expect(rows).toHaveCount(2);
    await rows.first().getByRole('button', { name: 'Comparer' }).click();
    await expect(page).toHaveURL(/\/compare$/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Comparer les versions');
    await expect(page.getByText('Ancienne version')).toBeVisible();

    // Archivage : plus démarrable.
    await page.goto('/processes');
    await page.getByPlaceholder('Rechercher un processus').fill(p.name);
    const v1 = page.getByRole('row', { name: new RegExp(`${p.name}.*v1`) });
    await v1.getByRole('button', { name: 'Archiver' }).click();
    await expect(v1).toContainText('Archivé');
    await expect(v1.getByRole('button', { name: 'Démarrer' })).toHaveCount(0);
    expect(await api.status('operator', 'POST', `/instances/processes/${p.id}/start`, { formData: { ref: 'x' } })).toBe(409);
  });

  test('corbeille : supprimer, restaurer, supprimer définitivement', async ({ page, api }) => {
    const p = await createProcess(api, uniq('Corbeille'), false);
    await page.goto('/processes');
    await page.getByPlaceholder('Rechercher un processus').fill(p.name);
    await page.getByRole('row', { name: new RegExp(p.name) }).getByRole('button', { name: 'Supprimer' }).click();
    await expect(page.getByRole('row', { name: new RegExp(p.name) })).toHaveCount(0);

    await page.getByRole('link', { name: 'Corbeille' }).click();
    await expect(page).toHaveURL(/\/processes\/trash$/);
    const trashed = page.getByRole('row', { name: new RegExp(p.name) });
    await expect(trashed).toContainText('Administrateur Système');
    await trashed.getByRole('button', { name: 'Restaurer' }).click();
    await expect(trashed).toHaveCount(0);

    await page.goto('/processes');
    await page.getByPlaceholder('Rechercher un processus').fill(p.name);
    await page.getByRole('row', { name: new RegExp(p.name) }).getByRole('button', { name: 'Supprimer' }).click();
    await page.goto('/processes/trash');
    await page.getByRole('row', { name: new RegExp(p.name) }).getByRole('button', { name: 'Supprimer définitivement' }).click();
    await expect(page.getByRole('row', { name: new RegExp(p.name) })).toHaveCount(0);
    expect(await api.status('admin', 'GET', `/processes/${p.id}`)).toBe(404);
  });

  test('un processus avec instances ne peut pas être supprimé', async ({ api }) => {
    const p = await createProcess(api, uniq('AvecInstance'));
    await startInstance(api, p.id, 'x', 'admin');
    await api.call('admin', 'POST', `/processes/${p.id}/archive`);
    expect(await api.status('admin', 'POST', `/processes/${p.id}/delete`)).toBe(409);
  });

  test('import XML : un fichier valide et un invalide ; modèle téléchargeable', async ({ page }) => {
    const name = uniq('Import');
    await page.goto('/processes');
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Modèle XML' }).click();
    expect((await download).suggestedFilename()).toBe('modele_import_processus.xml');

    await page.locator('input[type=file]').setInputFiles([
      { name: 'valide.bpmn', mimeType: 'application/xml', buffer: Buffer.from(workflowXml(name)) },
      { name: 'casse.xml', mimeType: 'application/xml', buffer: Buffer.from('<pas du bpmn') },
    ]);
    const result = page.locator('.card', { has: page.getByRole('heading', { name: "Résultat de l'import XML" }) });
    await expect(result).toContainText('1 processus créé(s)');
    await expect(result).toContainText('1 erreur(s)');
    await expect(result).toContainText('casse.xml');
    await page.getByPlaceholder('Rechercher un processus').fill(name);
    await expect(page.getByRole('row', { name: new RegExp(name) })).toContainText('Brouillon');
  });

  test('filtre par statut', async ({ page, api }) => {
    const p = await createProcess(api, uniq('Filtre'), false);
    await page.goto('/processes');
    await page.getByPlaceholder('Rechercher un processus').fill(p.name);
    await expect(page.getByRole('row', { name: new RegExp(p.name) })).toHaveCount(1);
    await page.locator('select').first().selectOption({ label: 'Publié' });
    await expect(page.getByRole('row', { name: new RegExp(p.name) })).toHaveCount(0);
    await page.locator('select').first().selectOption({ label: 'Brouillon' });
    await expect(page.getByRole('row', { name: new RegExp(p.name) })).toHaveCount(1);
  });

  test('export PDF : ouvre un onglet imprimable avec le diagramme', async ({ page, api }) => {
    const p = await createProcess(api, uniq('Pdf'));
    await page.goto(`/processes/${p.id}`);
    const popup = page.waitForEvent('popup');
    await page.getByRole('button', { name: 'Imprimer PDF' }).click();
    const tab = await popup;
    await expect(tab.locator('html')).toHaveAttribute('lang', 'fr');
    await expect(tab.locator('body')).toContainText(p.name);
    await expect(tab.locator('svg').first()).toBeVisible();
    await tab.close();
  });
});

test.describe('Matrice de droits', () => {
  test('masquer un champ au valideur sans bloquer les autres étapes', async ({ page, browser, api }) => {
    const p = await createProcess(api, uniq('Matrice'));
    await page.goto(`/processes/${p.id}/permissions`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Matrice de droits');
    const step = page.locator('.card', { has: page.getByRole('heading', { name: 'Validation E2E' }) });
    // Colonnes : tout le dossier (démarrage + étapes), pas seulement l'étape.
    for (const col of ['Référence dossier', 'Montant', 'Note', 'Approuvé ?']) {
      await expect(step.locator('thead')).toContainText(col);
    }
    const validatorRow = step.getByRole('row', { name: /VALIDATOR/ });
    await expect(validatorRow).toContainText('Aucune règle : accès par défaut');
    // Par défaut : lecture de tout, écriture uniquement sur le champ de l'étape.
    await expect(validatorRow.getByRole('cell').nth(2).getByLabel('L')).toBeChecked();
    await expect(validatorRow.getByRole('cell').nth(2).getByLabel('E')).toHaveCount(0);
    await expect(validatorRow.getByRole('cell').nth(4).getByLabel('E')).toBeChecked();

    await validatorRow.getByRole('cell').nth(2).getByLabel('L').uncheck(); // Montant
    await expect(validatorRow).not.toContainText('Aucune règle');
    await expect(validatorRow.getByLabel('Déposer documents')).toBeChecked();
    await page.getByRole('button', { name: 'Enregistrer la matrice' }).click();
    await expect(page.getByText('Enregistré')).toBeVisible();

    // Seule la règle modifiée est enregistrée.
    const { permissions } = await api.call('admin', 'GET', `/processes/${p.id}/permissions`);
    expect(permissions).toHaveLength(1);
    expect(permissions[0].step_name).toBe('Validation E2E');
    expect(permissions[0].field_permissions.amount.read).toBe(false);
    expect(permissions[0].field_permissions.ref.read).toBe(true);

    await page.reload();
    await expect(step.getByRole('row', { name: /VALIDATOR/ })).not.toContainText('Aucune règle');
    await expect(step.getByRole('row', { name: /VALIDATOR/ }).getByRole('cell').nth(2).getByLabel('L')).not.toBeChecked();
    const saisie = page.locator('.card', { has: page.getByRole('heading', { name: 'Saisie E2E' }) });
    await expect(saisie.getByRole('row', { name: /OPERATOR/ })).toContainText('Aucune règle : accès par défaut');

    // L'opérateur traite toujours son étape normalement.
    const ref = uniq('REF-MAT');
    const instanceId = await startInstance(api, p.id, ref);
    const t1 = await pendingTaskOf(api, 'operator', instanceId);
    await api.call('operator', 'POST', `/tasks/${t1.id}/complete`, { formData: { amount: 999, note: 'confidentiel' } });

    // Le valideur voit la référence et la note, pas le montant, et ne peut pas l'écrire.
    const t2 = await pendingTaskOf(api, 'validator', instanceId);
    expect(t2.instance_form_data.ref).toBe(ref);
    expect(t2.instance_form_data.amount).toBeUndefined();
    expect(await api.status('validator', 'POST', `/tasks/${t2.id}/complete`, { formData: { approved: true, amount: 1 } })).toBe(403);

    const vPage = await openAs(browser, 'validator');
    await vPage.goto('/tasks');
    await vPage.getByPlaceholder('Rechercher une tâche').fill(ref);
    const card = vPage.locator('.card', { hasText: ref });
    await expect(card).toContainText('note : confidentiel');
    await expect(card).not.toContainText('amount');
    await card.getByRole('button', { name: 'Traiter' }).click();
    await card.getByLabel('Approuvé ? *').selectOption('true');
    await card.getByRole('button', { name: 'Valider la tâche' }).click();
    await expect(vPage.locator('.card', { hasText: ref })).toHaveCount(0);
    await vPage.context().close();
  });
});
