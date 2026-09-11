import { useTranslation } from 'react-i18next';

interface Props {
  offset: number;
  limit: number;
  total: number;
  onOffsetChange: (offset: number) => void;
}

/** Contrôles précédent/suivant partagés par toutes les listes paginées côté serveur. */
export function Pagination({ offset, limit, total, onOffsetChange }: Props) {
  const { t } = useTranslation();

  if (total <= limit && offset === 0) return null;

  return (
    <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
      <button
        disabled={offset === 0}
        onClick={() => onOffsetChange(Math.max(0, offset - limit))}
        className="btn-secondary disabled:opacity-40"
      >
        {t('common.pagination.previous')}
      </button>
      <span>
        {t('common.pagination.range', { from: total === 0 ? 0 : offset + 1, to: Math.min(offset + limit, total), total })}
      </span>
      <button
        disabled={offset + limit >= total}
        onClick={() => onOffsetChange(offset + limit)}
        className="btn-secondary disabled:opacity-40"
      >
        {t('common.pagination.next')}
      </button>
    </div>
  );
}
