import { test, expect, openAs } from '../support/fixtures';
import { API_URL, uniq } from '../support/env';
import { workflowXml } from '../support/process';
import path from 'node:path';

test.describe('Contrôle d\'accès (opérateur)', () => {
  test.use({ as: 'operator' });

  test('pas de menu d\'administration, pages admin redirigées', async ({ page }) => {
    await page.goto('/dashboard');
    const nav = page.locator('header nav');
    await expect(nav.getByRole('link', { name: 'Champs' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Configuration' })).toHaveCount(0);
    for (const url of ['/admin/users', '/admin/audit', '/admin/roles', '/admin/database', '/admin/notifications', '/admin/fields']) {
      await page.goto(url);
      await expect(page, url).toHaveURL(/\/dashboard$/);
    }
    await page.goto('/processes');
    await expect(page.getByRole('button', { name: 'Nouveau processus' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Importer XML' })).toHaveCount(0);
  });

  test('l\'API refuse les actions d\'administration (403)', async ({ api }) => {
    const calls: [string, string, unknown?][] = [
      ['GET', '/admin/users'],
      ['POST', '/admin/users', { email: 'x@example.com', password: 'Abcdefgh1', firstName: 'x', lastName: 'y', roleNames: ['ADMIN'] }],
      ['GET', '/audit'],
      ['GET', '/admin/database-schema'],
      ['GET', '/admin/fields'],
      ['GET', '/admin/smtp'],
      ['PUT', '/admin/smtp', { host: 'evil.example.com' }],
      ['GET', '/admin/notification-templates'],
      ['POST', '/roles', { name: 'PIRATE' }],
      ['POST', '/processes', { name: 'Pirate' }],
      ['POST', '/processes/00000000-0000-0000-0000-000000000000/restore'],
    ];
    for (const [method, url, body] of calls) {
      expect(await api.status('operator', method, url, body), `${method} ${url}`).toBe(403);
    }
    // Élévation de privilèges via son propre profil : les rôles ne sont pas modifiables.
    const me = await api.call('operator', 'GET', '/auth/me');
    await api.call('operator', 'PUT', '/users/me', {
      firstName: me.user.firstName, lastName: me.user.lastName, email: me.user.email, phone: me.user.phone, roleNames: ['ADMIN'],
    });
    expect((await api.call('operator', 'GET', '/auth/me')).user.roles).not.toContain('ADMIN');
  });

  test('IDOR : une instance sans participation est invisible (liste, détail, documents)', async ({ page, api }) => {
    // Processus entièrement traité par VALIDATOR : l'opérateur n'y participe pas.
    const name = uniq('SansOperateur');
    const xml = workflowXml(name).replace('bpm:assigneeRole="OPERATOR"', 'bpm:assigneeRole="VALIDATOR"');
    const { process } = await api.call('admin', 'POST', '/processes', { name, bpmnXml: xml });
    await api.call('admin', 'POST', `/processes/${process.id}/publish`);
    const { instance } = await api.call('admin', 'POST', `/instances/processes/${process.id}/start`, { formData: { ref: 'secret' } });

    expect(await api.status('operator', 'GET', `/instances/${instance.id}`)).toBe(403);
    expect(await api.status('operator', 'GET', `/documents/instances/${instance.id}/documents`)).toBe(403);
    expect(await api.status('operator', 'POST', `/instances/${instance.id}/comments`, { body: 'intrus' })).toBe(403);
    const { instances } = await api.call('operator', 'GET', `/instances?limit=100`);
    expect(instances.some((i: any) => i.id === instance.id)).toBe(false);

    // Côté interface : pas de fuite des données du dossier.
    await page.goto(`/instances/${instance.id}`);
    await expect(page.locator('body')).not.toContainText('secret');
  });
});

test.describe('Régressions de sécurité', () => {
  test('en-têtes de sécurité sur l\'API', async ({ request }) => {
    const res = await request.get(`${API_URL}/health`);
    const h = res.headers();
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['x-frame-options']).toBe('SAMEORIGIN');
    expect(h['content-security-policy']).toContain("default-src 'self'");
    expect(h['x-powered-by']).toBeUndefined();
  });

  test('JWT non signé (alg=none) refusé', async ({ request }) => {
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const forged = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: '11111111-1111-1111-1111-111111111111' })}.`;
    const res = await request.get(`${API_URL}/auth/me`, { headers: { Authorization: `Bearer ${forged}` } });
    expect(res.status()).toBe(401);
  });

  test('entrées malformées : 400, jamais 500', async ({ api, request }) => {
    const token = await api.tokenOf('admin');
    const res = await request.post(`${API_URL}/clients`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: '{ pas du json',
    });
    expect(res.status()).toBe(400);
    expect(await api.status('admin', 'GET', '/instances/123')).toBe(400);
    expect(await api.status('admin', 'GET', "/search?q=' OR 1=1 --")).toBe(200);
    expect(await api.status('admin', 'GET', "/processes?q=%27%3B%20DROP%20TABLE%20users%3B--")).toBe(200);
  });

  test('XSS : un nom de processus contenant du HTML est affiché comme du texte', async ({ page, api }) => {
    const name = `E2E <img src=x onerror="window.__xss=1"> ${Date.now()}`;
    await api.call('admin', 'POST', '/processes', { name, bpmnXml: workflowXml('xss') });
    await page.goto('/processes');
    await page.getByPlaceholder('Rechercher un processus').fill('onerror');
    await expect(page.getByRole('cell', { name })).toBeVisible();
    expect(await page.evaluate(() => (window as any).__xss)).toBeUndefined();
  });

  test('upload : un fichier « .html » déclaré text/plain est servi en text/plain', async ({ api, request }) => {
    const name = uniq('Upload');
    const { process } = await api.call('admin', 'POST', '/processes', { name, bpmnXml: workflowXml(name) });
    await api.call('admin', 'POST', `/processes/${process.id}/publish`);
    const { instance } = await api.call('admin', 'POST', `/instances/processes/${process.id}/start`, { formData: { ref: 'x' } });
    const token = await api.tokenOf('admin');
    const up = await request.post(`${API_URL}/documents/instances/${instance.id}/documents`, {
      headers: { Authorization: `Bearer ${token}` },
      multipart: { file: { name: 'piege.html', mimeType: 'text/plain', buffer: Buffer.from('<script>alert(1)</script>') } },
    });
    expect(up.status()).toBe(201);
    const { document } = await up.json();
    const dl = await request.get(`${API_URL}/documents/${document.id}`, { headers: { Authorization: `Bearer ${token}` } });
    expect(dl.headers()['content-type']).toMatch(/^text\/plain/);
    expect(dl.headers()['content-disposition']).toContain('attachment');
  });

  test('upload trop volumineux : 413 explicite', async ({ api, request }) => {
    const name = uniq('Gros');
    const { process } = await api.call('admin', 'POST', '/processes', { name, bpmnXml: workflowXml(name) });
    await api.call('admin', 'POST', `/processes/${process.id}/publish`);
    const { instance } = await api.call('admin', 'POST', `/instances/processes/${process.id}/start`, { formData: { ref: 'x' } });
    const token = await api.tokenOf('admin');
    const up = await request.post(`${API_URL}/documents/instances/${instance.id}/documents`, {
      headers: { Authorization: `Bearer ${token}` },
      multipart: { file: { name: 'gros.txt', mimeType: 'text/plain', buffer: Buffer.alloc(21 * 1024 * 1024, 'a') } },
    });
    expect(up.status()).toBe(413);
  });
});
