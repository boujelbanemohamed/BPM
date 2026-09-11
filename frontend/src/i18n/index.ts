import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import fr from './locales/fr.json';
import en from './locales/en.json';

export const SUPPORTED_LANGUAGES = ['fr', 'en'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

const STORAGE_KEY = 'bpm_locale';

function getStoredLanguage(): SupportedLanguage {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && (SUPPORTED_LANGUAGES as readonly string[]).includes(stored)) return stored as SupportedLanguage;
  } catch {
    /* localStorage indisponible (mode privé, etc.) : on retombe sur le français */
  }
  return 'fr';
}

export function setLanguage(lang: SupportedLanguage): void {
  i18n.changeLanguage(lang);
  document.documentElement.lang = lang;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* best-effort : la session reste fonctionnelle même sans persistance */
  }
}

i18n.use(initReactI18next).init({
  resources: { fr: { translation: fr }, en: { translation: en } },
  lng: getStoredLanguage(),
  fallbackLng: 'fr',
  interpolation: { escapeValue: false },
});

document.documentElement.lang = i18n.language;

export default i18n;
