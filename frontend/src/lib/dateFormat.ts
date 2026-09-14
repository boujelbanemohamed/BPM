import i18n from '../i18n';

function localeForCurrentLanguage(): string {
  return i18n.language === 'en' ? 'en-US' : 'fr-FR';
}

/** Date + heure localisées selon la langue actuelle de l'interface (fr-FR / en-US). */
export function formatDateTime(value: string | number | Date): string {
  return new Date(value).toLocaleString(localeForCurrentLanguage());
}

/** Date seule (sans heure), localisée selon la langue actuelle de l'interface. */
export function formatDate(value: string | number | Date, options?: Intl.DateTimeFormatOptions): string {
  return new Date(value).toLocaleDateString(localeForCurrentLanguage(), options);
}
