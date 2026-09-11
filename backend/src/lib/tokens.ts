import crypto from 'crypto';

/**
 * Génère un token opaque à haute entropie (mot de passe oublié, refresh
 * token) et son empreinte SHA-256 stockée en base. Contrairement à un
 * secret choisi par un humain, un hash rapide suffit ici : rien à protéger
 * d'une attaque par dictionnaire, et l'empreinte doit permettre une
 * recherche directe par égalité en base.
 */
export function generateOpaqueToken(): { raw: string; hash: string } {
  const raw = crypto.randomBytes(32).toString('base64url');
  return { raw, hash: hashOpaqueToken(raw) };
}

export function hashOpaqueToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}
