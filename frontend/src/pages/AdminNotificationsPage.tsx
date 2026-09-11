import { FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, Mail, RotateCcw, Save, Send, Settings } from 'lucide-react';
import { api } from '../api/client';
import { NotificationTemplate, SmtpSettings } from '../types';
import { useAuth } from '../context/AuthContext';

function SmtpSettingsTab() {
  const { t } = useTranslation();
  const { hasAccess } = useAuth();
  const canEdit = hasAccess('NOTIFICATIONS_CONFIG', 'FULL');
  const [settings, setSettings] = useState<SmtpSettings | null>(null);
  const [host, setHost] = useState('');
  const [port, setPort] = useState(587);
  const [secure, setSecure] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [fromAddress, setFromAddress] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testStatus, setTestStatus] = useState<string | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  function load() {
    api.getSmtpSettings().then(({ settings }) => {
      setSettings(settings);
      setHost(settings.host);
      setPort(settings.port);
      setSecure(settings.secure);
      setUsername(settings.username);
      setFromAddress(settings.fromAddress);
      setPassword('');
    });
  }

  useEffect(load, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setStatus(t('profile.saving'));
    try {
      await api.updateSmtpSettings({
        host,
        port,
        secure,
        username: username || undefined,
        password: password || undefined,
        fromAddress: fromAddress || undefined,
      });
      setStatus(t('profile.saved'));
      load();
      setTimeout(() => setStatus(null), 1500);
    } catch (err) {
      setError((err as Error).message);
      setStatus(null);
    }
  }

  async function sendTest() {
    setTestError(null);
    setTestStatus(null);
    setTesting(true);
    try {
      await api.sendSmtpTestEmail();
      setTestStatus(t('adminNotifications.smtp.testSuccess'));
    } catch (err) {
      setTestError((err as Error).message);
    } finally {
      setTesting(false);
    }
  }

  if (!settings) return <div className="p-6 text-slate-400">{t('adminNotifications.smtp.loading')}</div>;

  return (
    <form onSubmit={save} className="card max-w-2xl space-y-4">
      <p className="text-sm text-slate-500">
        {t('adminNotifications.smtp.envHint')}{' '}
        <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">backend/.env</code>{' '}
        {t('adminNotifications.smtp.envHintMiddle')}{' '}
        <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">SMTP_*</code>
        {t('adminNotifications.smtp.envHintEnd')}
      </p>

      <div className="grid grid-cols-2 gap-4">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-500">{t('adminNotifications.smtp.host')}</span>
          <input
            className="input"
            placeholder="smtp.example.com"
            value={host}
            disabled={!canEdit}
            onChange={(e) => setHost(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-500">{t('adminNotifications.smtp.port')}</span>
          <input
            type="number"
            className="input"
            value={port}
            disabled={!canEdit}
            onChange={(e) => setPort(Number(e.target.value))}
          />
        </label>
      </div>

      <label className="flex items-center gap-2 text-sm text-slate-600">
        <input type="checkbox" checked={secure} disabled={!canEdit} onChange={(e) => setSecure(e.target.checked)} />
        {t('adminNotifications.smtp.secureLabel')}
      </label>

      <div className="grid grid-cols-2 gap-4">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-500">{t('adminNotifications.smtp.username')}</span>
          <input className="input" value={username} disabled={!canEdit} onChange={(e) => setUsername(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-500">
            {t('adminNotifications.smtp.passwordLabel')} {settings.hasPassword ? t('adminNotifications.smtp.passwordKeepHint') : ''}
          </span>
          <input
            type="password"
            className="input"
            value={password}
            disabled={!canEdit}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
      </div>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate-500">{t('adminNotifications.smtp.fromAddress')}</span>
        <input
          className="input"
          placeholder='"BPM Platform" <no-reply@bpm.local>'
          value={fromAddress}
          disabled={!canEdit}
          onChange={(e) => setFromAddress(e.target.value)}
        />
      </label>

      {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      {canEdit && (
        <div className="flex items-center gap-3">
          <button type="submit" className="btn-primary">
            <Save size={16} /> {t('adminNotifications.smtp.save')}
          </button>
          {status && <span className="text-sm text-slate-400">{status}</span>}
        </div>
      )}

      {canEdit && (
        <div className="border-t border-slate-100 pt-4">
          <button type="button" onClick={sendTest} disabled={testing} className="btn-secondary">
            <Send size={16} /> {testing ? t('adminNotifications.smtp.sending') : t('adminNotifications.smtp.sendTest')}
          </button>
          <p className="mt-1 text-xs text-slate-400">{t('adminNotifications.smtp.testHint')}</p>
          {testStatus && <p className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{testStatus}</p>}
          {testError && <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{testError}</p>}
        </div>
      )}
    </form>
  );
}

function TemplatesTab() {
  const { t } = useTranslation();
  const { hasAccess } = useAuth();
  const canEdit = hasAccess('NOTIFICATIONS_CONFIG', 'FULL');
  const [templates, setTemplates] = useState<NotificationTemplate[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [heading, setHeading] = useState('');
  const [subject, setSubject] = useState('');
  const [bodyHtml, setBodyHtml] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null);
  const [previewing, setPreviewing] = useState(false);

  function load(selectKey?: string) {
    api.listNotificationTemplates().then(({ templates }) => {
      setTemplates(templates);
      const key = selectKey ?? selectedKey ?? templates[0]?.key ?? null;
      selectTemplate(key, templates);
    });
  }

  useEffect(load, []);

  function selectTemplate(key: string | null, list: NotificationTemplate[] = templates) {
    setSelectedKey(key);
    const tpl = list.find((item) => item.key === key);
    setHeading(tpl?.heading ?? '');
    setSubject(tpl?.subject ?? '');
    setBodyHtml(tpl?.body_html ?? '');
    setPreview(null);
    setError(null);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!selectedKey) return;
    setError(null);
    setStatus(t('profile.saving'));
    try {
      await api.updateNotificationTemplate(selectedKey, { heading, subject, bodyHtml });
      setStatus(t('profile.saved'));
      load(selectedKey);
      setTimeout(() => setStatus(null), 1500);
    } catch (err) {
      setError((err as Error).message);
      setStatus(null);
    }
  }

  async function reset() {
    if (!selectedKey) return;
    if (!window.confirm(t('adminNotifications.templates.confirmReset'))) return;
    await api.resetNotificationTemplate(selectedKey);
    load(selectedKey);
  }

  async function showPreview() {
    if (!selectedKey) return;
    setPreviewing(true);
    try {
      const result = await api.previewNotificationTemplate(selectedKey, { heading, subject, bodyHtml });
      setPreview(result);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPreviewing(false);
    }
  }

  const selected = templates.find((tpl) => tpl.key === selectedKey);

  return (
    <div className="grid grid-cols-[240px_1fr] gap-6">
      <div className="space-y-1">
        {templates.map((tpl) => (
          <button
            key={tpl.key}
            onClick={() => selectTemplate(tpl.key)}
            className={`block w-full rounded-lg px-3 py-2 text-left text-sm ${
              tpl.key === selectedKey ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            {t(`adminNotifications.templateLabels.${tpl.key}`, { defaultValue: tpl.key })}
          </button>
        ))}
      </div>

      {selected && (
        <div className="space-y-4">
          <form onSubmit={save} className="card space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-slate-700">
                {t(`adminNotifications.templateLabels.${selected.key}`, { defaultValue: selected.key })}
              </h2>
              {canEdit && (
                <button type="button" onClick={reset} className="btn-secondary">
                  <RotateCcw size={14} /> {t('adminNotifications.templates.reset')}
                </button>
              )}
            </div>

            <div className="flex flex-wrap gap-1.5">
              {selected.variables.map((v) => (
                <code key={v} className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-brand-700">
                  {`{{${v}}}`}
                </code>
              ))}
            </div>

            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500">{t('adminNotifications.templates.heading')}</span>
              <input className="input" value={heading} disabled={!canEdit} onChange={(e) => setHeading(e.target.value)} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500">{t('adminNotifications.templates.subject')}</span>
              <input className="input" value={subject} disabled={!canEdit} onChange={(e) => setSubject(e.target.value)} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500">{t('adminNotifications.templates.bodyHtml')}</span>
              <textarea
                className="input font-mono text-xs"
                rows={12}
                value={bodyHtml}
                disabled={!canEdit}
                onChange={(e) => setBodyHtml(e.target.value)}
              />
            </label>

            {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
            <div className="flex items-center gap-3">
              {canEdit && (
                <button type="submit" className="btn-primary">
                  <Save size={16} /> {t('adminNotifications.templates.save')}
                </button>
              )}
              <button type="button" onClick={showPreview} disabled={previewing} className="btn-secondary">
                <Eye size={16} /> {previewing ? t('adminNotifications.templates.generating') : t('adminNotifications.templates.preview')}
              </button>
              {status && <span className="text-sm text-slate-400">{status}</span>}
            </div>
          </form>

          {preview && (
            <div className="card space-y-2">
              <p className="text-xs font-medium text-slate-500">
                {t('adminNotifications.templates.previewSubject')} <span className="font-mono">{preview.subject}</span>
              </p>
              <iframe
                title={t('adminNotifications.templates.previewTitle') as string}
                srcDoc={preview.html}
                className="h-[420px] w-full rounded-lg border border-slate-200"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function AdminNotificationsPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'smtp' | 'templates'>('smtp');

  return (
    <div className="mx-auto max-w-5xl p-6">
      <h1 className="mb-6 flex items-center gap-2 text-2xl font-bold text-slate-800">
        <Mail size={22} /> {t('adminNotifications.title')}
      </h1>

      <div className="mb-6 flex gap-1 border-b border-slate-200">
        <button
          onClick={() => setTab('smtp')}
          className={`flex items-center gap-1.5 border-b-2 px-4 py-2 text-sm font-medium ${
            tab === 'smtp' ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <Settings size={15} /> {t('adminNotifications.tabs.smtp')}
        </button>
        <button
          onClick={() => setTab('templates')}
          className={`flex items-center gap-1.5 border-b-2 px-4 py-2 text-sm font-medium ${
            tab === 'templates' ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <Mail size={15} /> {t('adminNotifications.tabs.templates')}
        </button>
      </div>

      {tab === 'smtp' ? <SmtpSettingsTab /> : <TemplatesTab />}
    </div>
  );
}
