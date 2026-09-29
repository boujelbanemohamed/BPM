import fs from 'node:fs';
import path from 'node:path';
import { ACCOUNTS, API_URL, Role } from './env';

export interface Tokens {
  token: string;
  refreshToken: string;
}

// Une session par rôle, conservée entre les tests ET entre les exécutions :
// la connexion est limitée à 20 tentatives / 15 min, on ne se reconnecte donc
// que si le refresh token stocké n'est plus valide.
const STORE = path.join(__dirname, '..', '.auth', 'tokens.json');

function readStore(): Partial<Record<Role, Tokens>> {
  try {
    return JSON.parse(fs.readFileSync(STORE, 'utf8'));
  } catch {
    return {};
  }
}

export function saveTokens(role: Role, tokens: Tokens): void {
  const store = readStore();
  store[role] = tokens;
  fs.mkdirSync(path.dirname(STORE), { recursive: true });
  fs.writeFileSync(STORE, JSON.stringify(store, null, 2));
}

async function login(role: Role): Promise<Tokens> {
  const res = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ACCOUNTS[role]),
  });
  const body = await res.json();
  if (!res.ok || !body.token) {
    throw new Error(`Connexion ${role} impossible (${res.status}) : ${JSON.stringify(body)}`);
  }
  return { token: body.token, refreshToken: body.refreshToken };
}

async function refresh(refreshToken: string): Promise<Tokens | null> {
  const res = await fetch(`${API_URL}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });
  if (!res.ok) return null;
  return (await res.json()) as Tokens;
}

/** Renvoie une paire de jetons fraîche pour le rôle (refresh, sinon reconnexion). */
export async function freshTokens(role: Role): Promise<Tokens> {
  const stored = readStore()[role];
  const refreshed = stored ? await refresh(stored.refreshToken) : null;
  const tokens = refreshed ?? (await login(role));
  saveTokens(role, tokens);
  memory.set(role, { tokens, at: Date.now() });
  return tokens;
}

// Le jeton d'accès vit 15 min : on réutilise la même paire pendant 10 min dans
// un worker plutôt que de la faire tourner à chaque test (chaque rotation
// révoque le refresh token précédent, encore détenu par d'autres pages).
const REUSE_MS = 10 * 60 * 1000;
const memory = new Map<Role, { tokens: Tokens; at: number }>();

export async function sessionFor(role: Role): Promise<Tokens> {
  const cached = memory.get(role);
  if (cached && Date.now() - cached.at < REUSE_MS) return cached.tokens;
  return freshTokens(role);
}

/** Enregistre des jetons tournés par l'appli pendant un test. */
export function updateSession(role: Role, tokens: Tokens): void {
  const cached = memory.get(role);
  if (cached && cached.tokens.token === tokens.token) return;
  memory.set(role, { tokens, at: Date.now() });
  saveTokens(role, tokens);
}
