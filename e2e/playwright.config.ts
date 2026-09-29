import { defineConfig } from '@playwright/test';
import { WEB_URL } from './support/env';

export default defineConfig({
  testDir: './tests',
  // Les tests partagent une même base de données et des sessions par rôle :
  // exécution séquentielle pour rester déterministe.
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  globalSetup: './support/global-setup.ts',
  use: {
    baseURL: WEB_URL,
    viewport: { width: 1440, height: 900 },
    locale: 'fr-FR',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
});
