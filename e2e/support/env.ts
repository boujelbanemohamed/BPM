export const WEB_URL = process.env.E2E_WEB_URL ?? 'http://localhost:5173';
export const API_URL = process.env.E2E_API_URL ?? 'http://localhost:4000/api';

// Comptes de démonstration créés par db/init.sql (mot de passe commun).
const DEFAULT_PASSWORD = process.env.E2E_PASSWORD ?? 'Admin123!';

export const ACCOUNTS = {
  admin: { email: process.env.E2E_ADMIN_EMAIL ?? 'admin@bpm.local', password: DEFAULT_PASSWORD },
  operator: { email: process.env.E2E_OPERATOR_EMAIL ?? 'operator@bpm.local', password: DEFAULT_PASSWORD },
  validator: { email: process.env.E2E_VALIDATOR_EMAIL ?? 'validator@bpm.local', password: DEFAULT_PASSWORD },
} as const;

export type Role = keyof typeof ACCOUNTS;

/** Suffixe unique pour que chaque exécution crée ses propres données sans collision. */
export const RUN_ID = Date.now().toString(36);
export const uniq = (label: string) => `E2E ${label} ${RUN_ID}`;
