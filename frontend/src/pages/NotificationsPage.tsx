import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { BellRing, CheckCheck, Circle } from 'lucide-react';
import { api } from '../api/client';
import { NotificationItem } from '../types';
import { Pagination } from '../components/Pagination';
import { formatDateTime } from '../lib/dateFormat';

const LIMIT = 25;

export function NotificationsPage() {
  const { t } = useTranslation();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [unreadOnly, setUnreadOnly] = useState(false);

  async function refresh() {
    const { notifications, total } = await api.listNotifications({ limit: LIMIT, offset, unreadOnly });
    setNotifications(notifications);
    setTotal(total);
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offset, unreadOnly]);

  function toggleUnreadOnly() {
    setOffset(0);
    setUnreadOnly((prev) => !prev);
  }

  async function markRead(id: string) {
    try {
      await api.markNotificationRead(id);
      refresh();
    } catch (err) {
      window.alert((err as Error).message);
    }
  }

  async function markAllRead() {
    try {
      await api.markAllNotificationsRead();
      refresh();
    } catch (err) {
      window.alert((err as Error).message);
    }
  }

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-800">
          <BellRing size={22} /> {t('notifications.title')}
        </h1>
        <button onClick={markAllRead} className="btn-secondary">
          <CheckCheck size={16} /> {t('notifications.markAllRead')}
        </button>
      </div>

      <label className="mb-4 flex w-fit items-center gap-2 text-sm text-slate-600">
        <input type="checkbox" checked={unreadOnly} onChange={toggleUnreadOnly} />
        {t('notifications.unreadOnly')}
      </label>

      <div className="space-y-2">
        {notifications.map((n) => (
          <div
            key={n.id}
            className={`card flex items-start justify-between gap-4 ${!n.is_read ? 'border-brand-200 bg-brand-50/40' : ''}`}
          >
            <div className="flex items-start gap-3">
              {!n.is_read && <Circle size={8} className="mt-1.5 shrink-0 fill-brand-600 text-brand-600" />}
              <div>
                <p className="font-medium text-slate-800">{n.title}</p>
                <p className="text-sm text-slate-500">{n.message}</p>
                <p className="mt-1 text-xs text-slate-400">{formatDateTime(n.created_at)}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {n.link && (
                <Link to={n.link} className="text-xs font-semibold text-brand-600 hover:underline">
                  {t('notifications.open')}
                </Link>
              )}
              {!n.is_read && (
                <button onClick={() => markRead(n.id)} className="text-xs font-semibold text-slate-500 hover:underline">
                  {t('notifications.markRead')}
                </button>
              )}
            </div>
          </div>
        ))}
        {notifications.length === 0 && (
          <div className="card text-center text-slate-400">
            {unreadOnly ? t('notifications.emptyUnread') : t('notifications.empty')}
          </div>
        )}
      </div>
      <Pagination offset={offset} limit={LIMIT} total={total} onOffsetChange={setOffset} />
    </div>
  );
}
