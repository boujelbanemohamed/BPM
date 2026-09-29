import { test, expect } from '../support/fixtures';

const PAGES: [string, string][] = [
  ['/dashboard', 'Dashboard'],
  ['/processes', 'Processes'],
  ['/tasks', 'My tasks'],
  ['/instances', 'Instances'],
  ['/clients', 'Clients'],
  ['/documents', 'Documents'],
  ['/notifications', 'Notifications'],
  ['/profile', 'My profile'],
  ['/admin/users', 'User administration'],
  ['/admin/roles', 'Roles'],
  ['/admin/audit', 'Audit trail'],
  ['/admin/fields', 'Fields registry'],
  ['/admin/database', 'Database'],
  ['/admin/notifications', 'Notifications'],
  ['/processes/trash', 'Trash'],
];

// Une clé i18n non résolue s'afficherait telle quelle (ex. « dashboard.kpis.clients »).
const RAW_KEY = /\b(common|dashboard|processes|tasks|instances|clients|documents|audit|adminUsers|roles|designer|matrix|fields|database|adminNotifications|profile|notifications|instanceDetail|trash|diff|bpmnDesigner|clientPicker|instanceStatus|taskStatus|processStatus)\.[a-zA-Z]+(\.[a-zA-Z]+)*\b/;

test('toutes les pages s\'affichent en anglais sans clé de traduction brute', async ({ page }) => {
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'EN', exact: true }).click();
  for (const [url, heading] of PAGES) {
    await page.goto(url);
    await expect(page.getByRole('heading', { level: 1 }).first(), url).toContainText(heading);
    const text = await page.locator('main, body').first().innerText();
    expect(text, url).not.toMatch(RAW_KEY);
  }
  await page.getByRole('button', { name: 'FR', exact: true }).click();
});
