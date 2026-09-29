import { API_URL, ACCOUNTS, Role, WEB_URL } from './env';
import { freshTokens } from './sessions';

export default async function globalSetup() {
  for (const [label, url] of [
    ['API', `${API_URL}/health`],
    ['frontend', WEB_URL],
  ]) {
    const res = await fetch(url).catch(() => null);
    if (!res || !res.ok) {
      throw new Error(`${label} injoignable sur ${url} : démarrez backend et frontend (npm run dev) avant les tests.`);
    }
  }
  for (const role of Object.keys(ACCOUNTS) as Role[]) {
    await freshTokens(role);
  }
}
