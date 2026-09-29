import { test, expect } from '../support/fixtures';

test.describe('En-tête et navigation (admin)', () => {
  test('le titre est « BPM » et chaque lien du menu ouvre sa page', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.locator('header').getByText('BPM', { exact: true })).toBeVisible();

    const nav = page.locator('header nav');
    const links: [string, RegExp, string][] = [
      ['Processus', /\/processes$/, 'Processus'],
      ['Mes tâches', /\/tasks$/, 'Mes tâches'],
      ['Instances', /\/instances$/, 'Instances'],
      ['Clients', /\/clients$/, 'Clients'],
      ['Documents', /\/documents$/, 'Documents'],
      ['Champs', /\/admin\/fields$/, 'Registre des champs'],
      ['Tableau de bord', /\/dashboard$/, 'Tableau de bord'],
    ];
    for (const [label, url, heading] of links) {
      await nav.getByRole('link', { name: label, exact: true }).click();
      await expect(page).toHaveURL(url);
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    }
  });

  test('tout l\'en-tête tient dans la largeur, sans défilement horizontal de la page', async ({ page }) => {
    await page.goto('/dashboard');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await expect(page.getByRole('button', { name: /Administrateur/ })).toBeInViewport();
    await expect(page.getByRole('button', { name: 'Configuration' })).toBeInViewport({ ratio: 1 });
  });

  test('menu Configuration : ouverture, entrées, Échap, navigation', async ({ page }) => {
    await page.goto('/dashboard');
    const button = page.getByRole('button', { name: 'Configuration' });
    await button.click();
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    const menu = page.getByRole('menu');
    for (const item of ['Notifications', 'Base de données', 'Audit', 'Rôles', 'Utilisateurs']) {
      await expect(menu.getByRole('menuitem', { name: item })).toBeVisible();
    }
    // Le menu est réellement affiché (pas rogné par la barre de navigation).
    const box = await menu.boundingBox();
    expect(box!.height).toBeGreaterThan(150);

    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(button).toBeFocused();

    await button.click();
    await page.getByRole('menuitem', { name: 'Rôles' }).click();
    await expect(page).toHaveURL(/\/admin\/roles$/);
    await expect(page.getByRole('menu')).toBeHidden();

    // Clic à l'extérieur : fermeture.
    await button.click();
    await expect(page.getByRole('menu')).toBeVisible();
    await page.getByRole('heading', { level: 1 }).click();
    await expect(page.getByRole('menu')).toBeHidden();
  });

  test('menu profil : prénom/nom, rôles, lien vers le profil', async ({ page }) => {
    await page.goto('/dashboard');
    const profile = page.getByRole('button', { name: /Administrateur/ });
    await expect(profile).toContainText('Administrateur');
    await expect(profile).toContainText('Système');
    await profile.click();
    const menu = page.getByRole('menu');
    await expect(menu).toContainText('ADMIN');
    await menu.getByRole('menuitem', { name: 'Mon profil' }).click();
    await expect(page).toHaveURL(/\/profile$/);
    await expect(page.getByRole('menu')).toBeHidden();
  });

  test('bascule FR / EN : libellés, statuts et persistance', async ({ page }) => {
    await page.goto('/instances');
    await page.getByRole('button', { name: 'EN', exact: true }).click();
    await expect(page.locator('header nav')).toContainText('My tasks');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Instances');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await page.reload();
    await expect(page.locator('header nav')).toContainText('My tasks');
    await page.getByRole('button', { name: 'FR', exact: true }).click();
    await expect(page.locator('header nav')).toContainText('Mes tâches');
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  });

  test('recherche globale : trouve un processus et y navigue', async ({ page }) => {
    await page.goto('/dashboard');
    await page.getByRole('button', { name: 'Rechercher', exact: true }).click();
    await page.getByPlaceholder('Rechercher...').fill('Demande');
    const result = page.getByRole('button', { name: /Demande de congés/ }).first();
    await expect(result).toBeVisible();
    await result.click();
    await expect(page).toHaveURL(/\/processes\/[0-9a-f-]+$/);
  });

  test('recherche globale : aucun résultat', async ({ page }) => {
    await page.goto('/dashboard');
    await page.getByRole('button', { name: 'Rechercher', exact: true }).click();
    await page.getByPlaceholder('Rechercher...').fill('zzzz-introuvable-e2e');
    await expect(page.getByText('Aucun résultat pour « zzzz-introuvable-e2e »')).toBeVisible();
  });
});
