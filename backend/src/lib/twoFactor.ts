import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import QRCode from 'qrcode';
import { generateSecret, generateURI, verify } from 'otplib';
import { env } from '../config/env';

export function generateTotpSecret(): string {
  return generateSecret();
}

export async function generateTotpQrCode(secret: string, accountEmail: string): Promise<string> {
  const uri = generateURI({ issuer: env.TWO_FACTOR_ISSUER, label: accountEmail, secret });
  return QRCode.toDataURL(uri);
}

/** Tolère un pas de temps (30s) de dérive de part et d'autre, comme la plupart des apps d'authentification. */
export async function verifyTotpCode(secret: string, code: string): Promise<boolean> {
  if (!/^\d{6}$/.test(code)) return false;
  const result = await verify({ secret, token: code, epochTolerance: 30 });
  return result.valid;
}

const BACKUP_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans caractères ambigus (0/O, 1/I/L)

function generateBackupCode(): string {
  const bytes = crypto.randomBytes(10);
  let code = '';
  for (let i = 0; i < 10; i++) {
    code += BACKUP_CODE_ALPHABET[bytes[i] % BACKUP_CODE_ALPHABET.length];
    if (i === 4) code += '-';
  }
  return code;
}

export async function generateBackupCodes(count = 8): Promise<{ plain: string[]; hashes: string[] }> {
  const plain = Array.from({ length: count }, generateBackupCode);
  const hashes = await Promise.all(plain.map((code) => bcrypt.hash(code, env.BCRYPT_ROUNDS)));
  return { plain, hashes };
}

export async function verifyBackupCode(code: string, hash: string): Promise<boolean> {
  return bcrypt.compare(code.trim().toUpperCase(), hash);
}
