import { test as base, expect, APIRequestContext, Browser, BrowserContext, Page, request as pwRequest } from '@playwright/test';
import { API_URL, Role, WEB_URL } from './env';
import { sessionFor, Tokens, updateSession } from './sessions';

export interface Api {
  /** Appel REST authentifié avec le rôle donné ; échoue si le statut n'est pas 2xx. */
  call<T = any>(role: Role, method: string, path: string, body?: unknown): Promise<T>;
  /** Appel REST authentifié renvoyant le statut brut (pour tester les refus). */
  status(role: Role, method: string, path: string, body?: unknown): Promise<number>;
  tokenOf(role: Role): Promise<string>;
}

interface Fixtures {
  /** Rôle avec lequel la page est déjà connectée ; null = visiteur anonyme. */
  as: Role | null;
  api: Api;
}

function injectSession(target: Page | BrowserContext, tokens: Tokens) {
  return target.addInitScript((t: Tokens) => {
    if (sessionStorage.getItem('e2e_session_injected')) return;
    localStorage.setItem('bpm_token', t.token);
    localStorage.setItem('bpm_refresh_token', t.refreshToken);
    localStorage.setItem('bpm_locale', 'fr');
    sessionStorage.setItem('e2e_session_injected', '1');
  }, tokens);
}

/** Ouvre un second onglet isolé connecté avec un autre rôle (scénarios multi-acteurs). */
export async function openAs(browser: Browser, role: Role): Promise<Page> {
  const context = await browser.newContext({ baseURL: WEB_URL, locale: 'fr-FR', viewport: { width: 1440, height: 900 } });
  await injectSession(context, await sessionFor(role));
  return context.newPage();
}

/** Ouvre un onglet connecté avec un compte arbitraire (ex. utilisateur jetable créé par un test). */
export async function openWithLogin(browser: Browser, email: string, password: string): Promise<Page> {
  const res = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json();
  if (!res.ok || !body.token) throw new Error(`Connexion ${email} impossible (${res.status}) : ${JSON.stringify(body)}`);
  const context = await browser.newContext({ baseURL: WEB_URL, locale: 'fr-FR', viewport: { width: 1440, height: 900 } });
  await injectSession(context, { token: body.token, refreshToken: body.refreshToken });
  return context.newPage();
}

/** Client REST utilisable aussi hors fixture (beforeAll). */
export async function createApi(): Promise<{ api: Api; dispose: () => Promise<void> }> {
  const ctx: APIRequestContext = await pwRequest.newContext();
  async function tokenOf(role: Role) {
    return (await sessionFor(role)).token;
  }
  async function raw(role: Role, method: string, path: string, body?: unknown) {
    return ctx.fetch(`${API_URL}${path}`, {
      method,
      headers: { Authorization: `Bearer ${await tokenOf(role)}` },
      data: body,
    });
  }
  const api: Api = {
    tokenOf,
    async call(role, method, path, body) {
      const res = await raw(role, method, path, body);
      const text = await res.text();
      if (!res.ok()) throw new Error(`${method} ${path} (${role}) -> ${res.status()} ${text}`);
      return text ? JSON.parse(text) : null;
    },
    async status(role, method, path, body) {
      return (await raw(role, method, path, body)).status();
    },
  };
  return { api, dispose: () => ctx.dispose() };
}

export const test = base.extend<Fixtures>({
  as: ['admin', { option: true }],

  page: async ({ page, as }, use) => {
    if (as) {
      const tokens = await sessionFor(as);
      // Injection une seule fois par onglet : si l'appli fait tourner ses jetons
      // (refresh) ou se déconnecte, un rechargement ne doit pas les écraser.
      await injectSession(page, tokens);
    } else {
      await page.addInitScript(() => localStorage.setItem('bpm_locale', 'fr'));
    }
    await use(page);
    if (as) {
      // Récupère les jetons éventuellement tournés par l'appli pour la suite.
      const current = await page
        .evaluate(() => ({
          token: localStorage.getItem('bpm_token'),
          refreshToken: localStorage.getItem('bpm_refresh_token'),
        }))
        .catch(() => null);
      if (current?.token && current.refreshToken) {
        updateSession(as, { token: current.token, refreshToken: current.refreshToken });
      }
    }
  },

  api: async ({}, use) => {
    const { api, dispose } = await createApi();
    await use(api);
    await dispose();
  },
});

export { expect };
