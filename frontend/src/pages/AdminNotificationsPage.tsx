import { FormEvent, useEffect, useState } from 'react';
import { Eye, Mail, RotateCcw, Save, Send, Settings } from 'lucide-react';
import { api } from '../api/client';
import { NotificationTemplate, SmtpSettings } from '../types';

const TEMPLATE_LABELS: Record<string, string> = {
  WELCOME: 'Bienvenue (création de compte)',
  PASSWORD_CHANGED_SELF: 'Mot de passe modifié (par l\'utilisateur)',
  PASSWORD_CHANGED_BY_ADMIN: 'Mot de passe réinitialisé (par un admin)',
  TASK_ASSIGNED: 'Tâche assignée',
  TASK_DELEGATED: 'Tâche déléguée (suppléance)',
  ACCOUNT_DEACTIVATED: 'Compte désactivé',
  PROCESS_COMPLETED: 'Processus terminé',
};

function SmtpSettingsTab() {
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
    setStatus('Enregistrement…');
    try {
      await api.updateSmtpSettings({
        host,
        port,
        secure,
        username: username || undefined,
        password: password || undefined,
        fromAddress: fromAddress || undefined,
      });
      setStatus('Enregistré');
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
      setTestStatus('Email de test envoyé — vérifiez votre boîte de réception.');
    } catch (err) {
      setTestError((err as Error).message);
    } finally {
      setTesting(false);
    }
  }

  if (!settings) return <div className="p-6 text-slate-400">Chargement…</div>;

  return (
    <form onSubmit={save} className="card max-w-2xl space-y-4">
      <p className="text-sm text-slate-500">
        Si le champ "Serveur" ci-dessous est vide, la plateforme utilise la configuration du fichier{' '}
        <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">backend/.env</code> (variables{' '}
        <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">SMTP_*</code>).
      </p>

      <div className="grid grid-cols-2 gap-4">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-500">Serveur SMTP</span>
          <input className="input" placeholder="smtp.example.com" value={host} onChange={(e) => setHost(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-500">Port</span>
          <input
            type="number"
            className="input"
            value={port}
            onChange={(e) => setPort(Number(e.target.value))}
          />
        </label>
      </div>

      <label className="flex items-center gap-2 text-sm text-slate-600">
        <input type="checkbox" checked={secure} onChange={(e) => setSecure(e.target.checked)} />
        Connexion TLS implicite (à activer pour le port 465, désactiver pour le port 587 en STARTTLS)
      </label>

      <div className="grid grid-cols-2 gap-4">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-500">Identifiant</span>
          <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-500">
            Mot de passe {settings.hasPassword ? '(laisser vide pour ne pas le modifier)' : ''}
          </span>
          <input type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
      </div>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate-500">Adresse d'expédition</span>
        <input
          className="input"
          placeholder='"BPM Platform" <no-reply@bpm.local>'
          value={fromAddress}
          onChange={(e) => setFromAddress(e.target.value)}
        />
      </label>

      {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      <div className="flex items-center gap-3">
        <button type="submit" className="btn-primary">
          <Save size={16} /> Enregistrer
        </button>
        {status && <span className="text-sm text-slate-400">{status}</span>}
      </div>

      <div className="border-t border-slate-100 pt-4">
        <button type="button" onClick={sendTest} disabled={testing} className="btn-secondary">
          <Send size={16} /> {testing ? 'Envoi…' : 'Envoyer un email de test'}
        </button>
        <p className="mt-1 text-xs text-slate-400">Envoyé à votre propre adresse email, avec la configuration enregistrée ci-dessus.</p>
        {testStatus && <p className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{testStatus}</p>}
        {testError && <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{testError}</p>}
      </div>
    </form>
  );
}

function TemplatesTab() {
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
    const tpl = list.find((t) => t.key === key);
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
    setStatus('Enregistrement…');
    try {
      await api.updateNotificationTemplate(selectedKey, { heading, subject, bodyHtml });
      setStatus('Enregistré');
      load(selectedKey);
      setTimeout(() => setStatus(null), 1500);
    } catch (err) {
      setError((err as Error).message);
      setStatus(null);
    }
  }

  async function reset() {
    if (!selectedKey) return;
    if (!window.confirm('Réinitialiser ce modèle à son contenu par défaut ?')) return;
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

  const selected = templates.find((t) => t.key === selectedKey);

  return (
    <div className="grid grid-cols-[240px_1fr] gap-6">
      <div className="space-y-1">
        {templates.map((t) => (
          <button
            key={t.key}
            onClick={() => selectTemplate(t.key)}
            className={`block w-full rounded-lg px-3 py-2 text-left text-sm ${
              t.key === selectedKey ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            {TEMPLATE_LABELS[t.key] ?? t.key}
          </button>
        ))}
      </div>

      {selected && (
        <div className="space-y-4">
          <form onSubmit={save} className="card space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-slate-700">{TEMPLATE_LABELS[selected.key] ?? selected.key}</h2>
              <button type="button" onClick={reset} className="btn-secondary">
                <RotateCcw size={14} /> Réinitialiser
              </button>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {selected.variables.map((v) => (
                <code key={v} className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-brand-700">
                  {`{{${v}}}`}
                </code>
              ))}
            </div>

            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500">Titre affiché dans l'email</span>
              <input className="input" value={heading} onChange={(e) => setHeading(e.target.value)} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500">Objet de l'email</span>
              <input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500">Corps du message (HTML)</span>
              <textarea
                className="input font-mono text-xs"
                rows={12}
                value={bodyHtml}
                onChange={(e) => setBodyHtml(e.target.value)}
              />
            </label>

            {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
            <div className="flex items-center gap-3">
              <button type="submit" className="btn-primary">
                <Save size={16} /> Enregistrer
              </button>
              <button type="button" onClick={showPreview} disabled={previewing} className="btn-secondary">
                <Eye size={16} /> {previewing ? 'Génération…' : 'Aperçu'}
              </button>
              {status && <span className="text-sm text-slate-400">{status}</span>}
            </div>
          </form>

          {preview && (
            <div className="card space-y-2">
              <p className="text-xs font-medium text-slate-500">
                Objet : <span className="font-mono">{preview.subject}</span>
              </p>
              <iframe
                title="Aperçu de l'email"
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
  const [tab, setTab] = useState<'smtp' | 'templates'>('smtp');

  return (
    <div className="mx-auto max-w-5xl p-6">
      <h1 className="mb-6 flex items-center gap-2 text-2xl font-bold text-slate-800">
        <Mail size={22} /> Notifications
      </h1>

      <div className="mb-6 flex gap-1 border-b border-slate-200">
        <button
          onClick={() => setTab('smtp')}
          className={`flex items-center gap-1.5 border-b-2 px-4 py-2 text-sm font-medium ${
            tab === 'smtp' ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <Settings size={15} /> Paramètres SMTP
        </button>
        <button
          onClick={() => setTab('templates')}
          className={`flex items-center gap-1.5 border-b-2 px-4 py-2 text-sm font-medium ${
            tab === 'templates' ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <Mail size={15} /> Modèles d'emails
        </button>
      </div>

      {tab === 'smtp' ? <SmtpSettingsTab /> : <TemplatesTab />}
    </div>
  );
}
