import { test, expect, openWithLogin } from '../support/fixtures';
import { API_URL, RUN_ID, uniq } from '../support/env';
import { createProcess, pendingTaskOf, startInstance } from '../support/process';

const PASSWORD = 'Jetable123!';
const email = (tag: string) => `e2e-${tag}-${RUN_ID}@example.com`;

test.describe('Administration des utilisateurs', () => {
  test.beforeEach(async ({ page }) => page.on('dialog', (d) => d.accept()));

  test('créer, rechercher, filtrer, modifier, désactiver, réactiver', async ({ page, api }) => {
    const mail = email('user');
    await page.goto('/admin/users');
    await page.getByRole('button', { name: 'Nouvel utilisateur' }).click();
    const form = page.locator('form.card');
    await form.getByLabel('Prénom').fill('Alice');
    await form.getByLabel('Nom', { exact: true }).fill(`E2E ${RUN_ID}`);
    await form.getByLabel('Email').fill(mail);
    await form.getByLabel(/Mot de passe initial/).fill(PASSWORD);
    await form.getByLabel('OPERATOR').check();
    await form.getByRole('button', { name: 'Créer le compte' }).click();

    await page.getByPlaceholder('Rechercher un utilisateur').fill(mail);
    const row = page.getByRole('row', { name: new RegExp(mail) });
    await expect(row).toContainText('Alice');
    await expect(row).toContainText('OPERATOR');
    await expect(row).toContainText('Actif');

    // Modification : ajout d'un rôle.
    await row.getByRole('button', { name: 'Modifier' }).click();
    await expect(page.getByRole('heading', { name: "Modifier l'utilisateur" })).toBeVisible();
    await form.getByLabel('VALIDATOR').check();
    await form.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(row).toContainText('VALIDATOR');
    await expect(row).toContainText('OPERATOR');

    // Filtres rôle / statut.
    await page.locator('select').filter({ hasText: 'Tous les rôles' }).selectOption('ADMIN');
    await expect(row).toHaveCount(0);
    await page.locator('select').filter({ hasText: 'Tous les rôles' }).selectOption('VALIDATOR');
    await expect(row).toHaveCount(1);

    // Désactivation : la connexion est refusée ; réactivation : acceptée.
    await row.getByRole('button', { name: 'Désactiver' }).click();
    await expect(page.getByText(/Compte désactivé\. \d+ tâche\(s\) réassignée\(s\)\./)).toBeVisible();
    await expect(row).toContainText('Désactivé');
    let login = await page.request.post(`${API_URL}/auth/login`, { data: { email: mail, password: PASSWORD } });
    expect(login.status()).toBe(403);
    expect((await login.json()).error).toBe('Ce compte a été désactivé');
    await row.getByRole('button', { name: 'Réactiver' }).click();
    await expect(row).toContainText('Actif');
    login = await page.request.post(`${API_URL}/auth/login`, { data: { email: mail, password: PASSWORD } });
    expect(login.status()).toBe(200);
  });

  test('email en double refusé', async ({ api }) => {
    const status = await api.status('admin', 'POST', '/admin/users', {
      email: 'operator@bpm.local',
      password: PASSWORD,
      firstName: 'X',
      lastName: 'Y',
      roleNames: ['OPERATOR'],
    });
    expect(status).toBe(409);
  });

  test('import CSV : création, mise à jour et erreurs ligne par ligne', async ({ page }) => {
    const created = email('csv');
    await page.goto('/admin/users');
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Modèle CSV' }).click();
    expect((await download).suggestedFilename()).toBe('modele_import_utilisateurs.csv');

    const csv = [
      'email,prenom,nom,telephone,motdepasse,roles',
      `${created},Import,E2E ${RUN_ID},,${PASSWORD},OPERATOR`,
      'operator@bpm.local,Olivier,Opérateur,,,OPERATOR',
      'pas-un-email,X,Y,,,OPERATOR',
      `${email('csv2')},Sans,Role,,${PASSWORD},ROLE_INEXISTANT`,
    ].join('\n');
    await page.locator('input[type=file]').setInputFiles({ name: 'users.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
    const result = page.locator('.card', { has: page.getByRole('heading', { name: 'Résultat de l\'import CSV' }) });
    await expect(result).toContainText('1 créé(s)');
    await expect(result).toContainText('1 mis à jour');
    await expect(result).toContainText('2 erreur(s)');
    await expect(result).toContainText('Ligne');
  });

  test('désactiver un utilisateur réassigne ses tâches nominatives au suppléant', async ({ page, api }) => {
    // Utilisateur VALIDATOR jetable avec Brigitte (backup1) comme suppléante.
    const { users } = await api.call('admin', 'GET', '/users');
    const backup1 = users.find((u: any) => u.email === 'backup1@bpm.local');
    const mail = email('deleg');
    const { user } = await api.call('admin', 'POST', '/admin/users', {
      email: mail, password: PASSWORD, firstName: 'Deleg', lastName: `E2E ${RUN_ID}`, roleNames: ['VALIDATOR'],
    });
    await api.call('admin', 'PUT', `/admin/users/${user.id}`, { delegateUser1Id: backup1.id });

    // Processus dont l'étape de validation est assignée nominativement à cet utilisateur.
    const p = await createProcess(api, uniq('Nominatif'), false);
    const { process } = await api.call('admin', 'GET', `/processes/${p.id}`);
    const xml = process.bpmn_xml.replace('bpm:assigneeRole="VALIDATOR"', `bpm:assigneeRole="VALIDATOR" bpm:assigneeUserId="${user.id}"`);
    await api.call('admin', 'PUT', `/processes/${p.id}`, { bpmnXml: xml });
    await api.call('admin', 'POST', `/processes/${p.id}/publish`);
    const instanceId = await startInstance(api, p.id, uniq('REF-DELEG'));
    const t1 = await pendingTaskOf(api, 'operator', instanceId);
    await api.call('operator', 'POST', `/tasks/${t1.id}/complete`, { formData: { amount: 5 } });

    await page.goto('/admin/users');
    await page.getByPlaceholder('Rechercher un utilisateur').fill(mail);
    await page.getByRole('row', { name: new RegExp(mail) }).getByRole('button', { name: 'Désactiver' }).click();
    await expect(page.getByText('Compte désactivé. 1 tâche(s) réassignée(s).')).toBeVisible();

    await page.goto(`/instances/${instanceId}`);
    const taskRow = page.getByRole('row', { name: /Validation E2E/ });
    await expect(taskRow).toContainText('Brigitte');
    await expect(taskRow).toContainText('(suppléance)');
  });
});

test.describe('Rôles et accès aux pages', () => {
  test('créer un rôle, décrire, octroyer une page, effet réel pour un utilisateur', async ({ page, browser, api }) => {
    const roleName = `E2E_${RUN_ID.toUpperCase()}`;
    await page.goto('/admin/roles');
    await page.getByRole('button', { name: 'Nouveau rôle' }).click();
    await page.getByLabel(/Nom \(lettres, chiffres/).fill(roleName);
    await page.getByLabel('Description', { exact: true }).fill('Rôle de test E2E');
    await page.getByRole('button', { name: 'Créer le rôle' }).click();
    const card = page.locator('.card', { has: page.getByText(roleName, { exact: true }) });
    await expect(card).toContainText('Rôle de test E2E');
    await expect(card).toContainText('0 utilisateur');

    await card.getByRole('button', { name: 'Modifier' }).click();
    await card.getByPlaceholder('Description du rôle').fill('Description modifiée');
    await card.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await expect(card).toContainText('Description modifiée');

    // Nom invalide refusé.
    expect(await api.status('admin', 'POST', '/roles', { name: 'nom invalide !' })).toBe(400);

    // Octroi : Audit en consultation.
    await card.getByLabel('Audit').selectOption('VIEW');
    await card.getByRole('button', { name: 'Enregistrer les accès' }).click();
    await expect(card.getByText('Enregistré')).toBeVisible();

    const mail = email('role');
    await api.call('admin', 'POST', '/admin/users', {
      email: mail, password: PASSWORD, firstName: 'Role', lastName: `E2E ${RUN_ID}`, roleNames: [roleName],
    });
    const userPage = await openWithLogin(browser, mail, PASSWORD);
    await userPage.goto('/dashboard');
    await userPage.getByRole('button', { name: 'Configuration' }).click();
    await expect(userPage.getByRole('menuitem', { name: 'Audit' })).toBeVisible();
    await expect(userPage.getByRole('menuitem', { name: 'Utilisateurs' })).toHaveCount(0);
    await userPage.getByRole('menuitem', { name: 'Audit' }).click();
    await expect(userPage.getByRole('heading', { level: 1 })).toContainText('Audit trail');
    await userPage.goto('/admin/users');
    await expect(userPage).toHaveURL(/\/dashboard$/);
    await userPage.context().close();

    await page.reload();
    await expect(page.locator('.card', { has: page.getByText(roleName, { exact: true }) })).toContainText('1 utilisateur');
  });
});

test.describe('Audit, champs, base de données, modèles d\'emails', () => {
  test('audit : filtre par action et export CSV', async ({ page }) => {
    await page.goto('/admin/audit');
    await page.getByPlaceholder('Filtrer par action').fill('PROCESS_CREATED');
    await page.getByRole('button', { name: 'Filtrer' }).click();
    const rows = page.locator('tbody tr');
    await expect(rows.first()).toContainText('PROCESS_CREATED');
    const actions = await rows.locator('td:nth-child(3)').allTextContents();
    expect(actions.every((a) => a.includes('PROCESS_CREATED'))).toBe(true);
    await expect(page.getByText(/\d+ événement\(s\)/)).toBeVisible();

    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Exporter CSV' }).click();
    const text = Buffer.concat(await (await (await download).createReadStream()).toArray()).toString('utf8');
    expect(text).toContain('PROCESS_CREATED');
  });

  test('registre des champs : les champs des processus sont listés et filtrables', async ({ page, api }) => {
    const p = await createProcess(api, uniq('Champs'));
    await page.goto('/admin/fields');
    await page.getByPlaceholder('Filtrer par clé').fill(p.name);
    const block = page.locator('.card', { hasText: p.name });
    await expect(block).toContainText('amount');
    await expect(block).toContainText('Montant');
    await expect(block).toContainText('Référence dossier');
    await page.getByPlaceholder('Filtrer par clé').fill('zzz-aucun-champ');
    await expect(page.getByText('Aucun champ trouvé.')).toBeVisible();
  });

  test('schéma de base de données : recherche de table et colonne', async ({ page }) => {
    await page.goto('/admin/database');
    await expect(page.getByText(/Structure actuelle du schéma PostgreSQL \(\d+ tables\)/)).toBeVisible();
    await page.getByPlaceholder('Rechercher une table ou une colonne…').fill('refresh_tokens');
    await expect(page.locator('.card', { hasText: 'refresh_tokens' }).first()).toContainText('token_hash');
    // Les secrets ne sont jamais exposés, seulement la structure.
    await expect(page.locator('body')).not.toContainText('$2a$');
  });

  test('modèles d\'emails : aperçu d\'un modèle (sans modification)', async ({ page }) => {
    await page.goto('/admin/notifications');
    await expect(page.getByLabel('Serveur SMTP')).toBeVisible();
    await page.getByRole('button', { name: "Modèles d'emails" }).click();
    await page.getByRole('button', { name: 'Tâche assignée' }).click();
    await expect(page.getByLabel("Objet de l'email")).not.toHaveValue('');
    await page.getByRole('button', { name: 'Aperçu' }).click();
    await expect(page.getByText('Objet :')).toBeVisible();
    await expect(page.locator('iframe[title="Aperçu de l\'email"]')).toBeVisible();
  });
});
