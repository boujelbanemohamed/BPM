import { useTranslation } from 'react-i18next';
import { setLanguage, SUPPORTED_LANGUAGES, SupportedLanguage } from '../i18n';

const LABELS: Record<SupportedLanguage, string> = { fr: 'FR', en: 'EN' };

export function LanguageSwitcher() {
  const { i18n, t } = useTranslation();

  return (
    <div className="flex items-center rounded-lg border border-slate-200 p-0.5 text-xs font-semibold" aria-label={t('common.language')}>
      {SUPPORTED_LANGUAGES.map((lang) => (
        <button
          key={lang}
          onClick={() => setLanguage(lang)}
          className={`rounded-md px-1.5 py-1 transition-colors ${
            i18n.language === lang ? 'bg-brand-600 text-white' : 'text-slate-500 hover:bg-slate-100'
          }`}
        >
          {LABELS[lang]}
        </button>
      ))}
    </div>
  );
}
