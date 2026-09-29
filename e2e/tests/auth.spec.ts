import { test, expect } from '../support/fixtures';
import { ACCOUNTS, API_URL } from '../support/env';

test.describe('Authentification', () => {
  test.use({ as: null });

  test('une page protégée redirige un visiteur vers /login', async ({ page }) => {
    await page.goto('/instances');
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('button', { name: 'Se connecter' })).toBeVisible();
  });

  test('un mauvais mot de passe affiche une erreur sans connecter', async ({ page }) => {
    await page.goto('/login');
    await page.locator('input[type=email]').fill(ACCOUNTS.operator.email);
    await page.locator('input[type=password]').fill('mauvais-mot-de-passe');
    await page.getByRole('button', { name: 'Se connecter' }).click();
    await expect(page.locator('form p.text-rose-700')).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });

  test('connexion puis déconnexion depuis le menu profil', async ({ page }) => {
    await page.goto('/login');
    await page.locator('input[type=email]').fill(ACCOUNTS.validator.email);
    await page.locator('input[type=password]').fill(ACCOUNTS.validator.password);
    await page.getByRole('button', { name: 'Se connecter' }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole('heading', { name: 'Tableau de bord' })).toBeVisible();

    const refreshToken = await page.evaluate(() => localStorage.getItem('bpm_refresh_token'));
    expect(refreshToken).toBeTruthy();

    await page.getByRole('button', { name: /Valérie/ }).click();
    await page.getByRole('menuitem', { name: 'Déconnexion' }).click();
    await expect(page).toHaveURL(/\/login$/);
    expect(await page.evaluate(() => localStorage.getItem('bpm_token'))).toBeNull();

    // Le refresh token de la session fermée est révoqué côté serveur.
    const res = await page.request.post(`${API_URL}/auth/refresh`, { data: { refreshToken } });
    expect(res.status()).toBe(401);

    // Et la page protégée n'est plus accessible.
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('mot de passe oublié : message neutre (pas d\'énumération de comptes)', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('link', { name: 'Mot de passe oublié ?' }).click();
    await expect(page).toHaveURL(/\/forgot-password$/);
    await page.locator('input[type=email]').fill('inconnu-e2e@example.com');
    await page.getByRole('button', { name: 'Envoyer le lien' }).click();
    await expect(page.getByText('Si un compte existe avec cette adresse')).toBeVisible();
    await page.getByRole('link', { name: 'Retour à la connexion' }).first().click();
    await expect(page).toHaveURL(/\/login$/);
  });

  test('lien de réinitialisation sans jeton : message explicite', async ({ page }) => {
    await page.goto('/reset-password');
    await expect(page.getByText('Lien de réinitialisation invalide')).toBeVisible();
  });

  test('jeton de réinitialisation invalide refusé', async ({ page }) => {
    await page.goto('/reset-password?token=jeton-bidon');
    const inputs = page.locator('input[type=password]');
    await inputs.nth(0).fill('NouveauMdp123!');
    await inputs.nth(1).fill('NouveauMdp123!');
    await page.getByRole('button', { name: 'Choisir ce mot de passe' }).click();
    await expect(page.locator('p.text-rose-700')).toBeVisible();
  });

  test('l\'API refuse un jeton d\'accès falsifié', async ({ request }) => {
    const res = await request.get(`${API_URL}/auth/me`, { headers: { Authorization: 'Bearer abc.def.ghi' } });
    expect(res.status()).toBe(401);
  });

  test('les connexions réussies ne consomment pas le quota anti-force brute', async ({ request }) => {
    // 25 connexions réussies depuis la même IP (ex. bureau derrière un NAT) : aucune n'est bloquée.
    for (let i = 0; i < 25; i++) {
      const res = await request.post(`${API_URL}/auth/login`, { data: ACCOUNTS.operator });
      expect(res.status(), `connexion n°${i + 1}`).toBe(200);
    }
  });
});
