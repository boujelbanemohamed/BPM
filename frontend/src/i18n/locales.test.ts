import { describe, expect, it } from 'vitest';
import fr from './locales/fr.json';
import en from './locales/en.json';

function collectKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return collectKeys(value as Record<string, unknown>, path);
    }
    return [path];
  });
}

describe('i18n locale files', () => {
  it('fr and en expose exactly the same set of translation keys', () => {
    const frKeys = collectKeys(fr).sort();
    const enKeys = collectKeys(en).sort();

    const missingInEn = frKeys.filter((k) => !enKeys.includes(k));
    const missingInFr = enKeys.filter((k) => !frKeys.includes(k));

    expect(missingInEn, `Clés absentes de en.json : ${missingInEn.join(', ')}`).toEqual([]);
    expect(missingInFr, `Clés absentes de fr.json : ${missingInFr.join(', ')}`).toEqual([]);
  });

  it('no translation value is an empty string', () => {
    for (const [name, dict] of [
      ['fr', fr],
      ['en', en],
    ] as const) {
      const keys = collectKeys(dict);
      for (const key of keys) {
        const value = key.split('.').reduce<any>((acc, part) => acc?.[part], dict);
        expect(value, `${name}.json: clé "${key}" vide`).not.toBe('');
      }
    }
  });
});
