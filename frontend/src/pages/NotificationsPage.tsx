import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BellRing, CheckCheck, Circle } from 'lucide-react';
import { api } from '../api/client';
import { NotificationItem } from '../types';

export function NotificationsPage() {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);

  async function refresh() {
    const { notifications } = await api.listNotifications();
    setNotifications(notifications);
  }

  useEffect(() => {
    refresh();
  }, []);

  async function markRead(id: string) {
    await api.markNotificationRead(id);
    refresh();
  }

  async function markAllRead() {
    await api.markAllNotificationsRead();
    refresh();
  }

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-800">
          <BellRing size={22} /> Notifications
        </h1>
        <button onClick={markAllRead} className="btn-secondary">
          <CheckCheck size={16} /> Tout marquer comme lu
        </button>
      </div>

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
                <p className="mt-1 text-xs text-slate-400">{new Date(n.created_at).toLocaleString('fr-FR')}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {n.link && (
                <Link to={n.link} className="text-xs font-semibold text-brand-600 hover:underline">
                  Ouvrir
                </Link>
              )}
              {!n.is_read && (
                <button onClick={() => markRead(n.id)} className="text-xs font-semibold text-slate-500 hover:underline">
                  Marquer lu
                </button>
              )}
            </div>
          </div>
        ))}
        {notifications.length === 0 && <div className="card text-center text-slate-400">Aucune notification.</div>}
      </div>
    </div>
  );
}
