import { ChangeEvent, FormEvent, useEffect, useRef, useState } from 'react';
import { Camera, CheckCircle2, KeyRound, Mail, Save, ShieldCheck, ShieldOff, User as UserIcon, Users } from 'lucide-react';
import { api } from '../api/client';
import { MinimalUser, PublicUser } from '../types';
import { useAuth } from '../context/AuthContext';

export function ProfilePage() {
  const { user, refreshUser } = useAuth();
  const [delegation, setDelegation] = useState<PublicUser | null>(null);
  const [users, setUsers] = useState<MinimalUser[]>([]);
  const [delegate1, setDelegate1] = useState('');
  const [delegate2, setDelegate2] = useState('');
  const [absenceStart, setAbsenceStart] = useState('');
  const [absenceEnd, setAbsenceEnd] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [emailNotificationsEnabled, setEmailNotificationsEnabled] = useState(true);
  const [infoStatus, setInfoStatus] = useState<string | null>(null);
  const [infoError, setInfoError] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [pwStatus, setPwStatus] = useState<string | null>(null);
  const [pwError, setPwError] = useState<string | null>(null);

  const [twoFactorSetup, setTwoFactorSetup] = useState<{ secret: string; qrCodeDataUrl: string } | null>(null);
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [twoFactorError, setTwoFactorError] = useState<string | null>(null);
  const [twoFactorBusy, setTwoFactorBusy] = useState(false);
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [disabling, setDisabling] = useState(false);
  const [disablePassword, setDisablePassword] = useState('');
  const [disableError, setDisableError] = useState<string | null>(null);

  useEffect(() => {
    api.getMyDelegation().then(({ delegation }) => {
      setDelegation(delegation);
      setDelegate1(delegation.delegateUser1Id ?? '');
      setDelegate2(delegation.delegateUser2Id ?? '');
      setAbsenceStart(delegation.absenceStart ?? '');
      setAbsenceEnd(delegation.absenceEnd ?? '');
    });
    api.listUsersMinimal().then(({ users }) => setUsers(users));
  }, []);

  useEffect(() => {
    if (!user) return;
    setFirstName(user.firstName ?? '');
    setLastName(user.lastName ?? '');
    setPhone(user.phone ?? '');
    setEmail(user.email);
    setEmailNotificationsEnabled(user.emailNotificationsEnabled);
  }, [user]);

  async function saveInfo(e: FormEvent) {
    e.preventDefault();
    setInfoError(null);
    setInfoStatus('Enregistrement…');
    try {
      await api.updateMyProfile({ firstName, lastName, phone: phone || null, email, emailNotificationsEnabled });
      await refreshUser();
      setInfoStatus('Enregistré');
      setTimeout(() => setInfoStatus(null), 1500);
    } catch (err) {
      setInfoError((err as Error).message);
      setInfoStatus(null);
    }
  }

  async function onAvatarChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setAvatarError(null);
    setAvatarUploading(true);
    try {
      await api.uploadMyAvatar(file);
      await refreshUser();
    } catch (err) {
      setAvatarError((err as Error).message);
    } finally {
      setAvatarUploading(false);
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setStatus('Enregistrement…');
    try {
      const { delegation } = await api.updateMyDelegation({
        delegateUser1Id: delegate1 || null,
        delegateUser2Id: delegate2 || null,
        absenceStart: absenceStart || null,
        absenceEnd: absenceEnd || null,
      });
      setDelegation(delegation);
      setStatus('Enregistré');
      setTimeout(() => setStatus(null), 1500);
    } catch (err) {
      setError((err as Error).message);
      setStatus(null);
    }
  }

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    setPwError(null);
    setPwStatus('Enregistrement…');
    try {
      await api.changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setPwStatus('Mot de passe modifié');
      setTimeout(() => setPwStatus(null), 1500);
    } catch (err) {
      setPwError((err as Error).message);
      setPwStatus(null);
    }
  }

  async function startTwoFactorSetup() {
    setTwoFactorError(null);
    setBackupCodes(null);
    try {
      const setup = await api.setupTwoFactor();
      setTwoFactorSetup(setup);
    } catch (err) {
      setTwoFactorError((err as Error).message);
    }
  }

  async function confirmTwoFactorEnable(e: FormEvent) {
    e.preventDefault();
    setTwoFactorError(null);
    setTwoFactorBusy(true);
    try {
      const { backupCodes } = await api.enableTwoFactor(twoFactorCode.trim());
      setBackupCodes(backupCodes);
      setTwoFactorSetup(null);
      setTwoFactorCode('');
      await refreshUser();
    } catch (err) {
      setTwoFactorError((err as Error).message);
    } finally {
      setTwoFactorBusy(false);
    }
  }

  async function confirmTwoFactorDisable(e: FormEvent) {
    e.preventDefault();
    setDisableError(null);
    setTwoFactorBusy(true);
    try {
      await api.disableTwoFactor(disablePassword);
      setDisabling(false);
      setDisablePassword('');
      await refreshUser();
    } catch (err) {
      setDisableError((err as Error).message);
    } finally {
      setTwoFactorBusy(false);
    }
  }

  if (!delegation) return <div className="p-6 text-slate-400">Chargement…</div>;

  const otherUsers = users.filter((u) => u.id !== user?.id);

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <h1 className="text-2xl font-bold text-slate-800">Mon profil</h1>

      <div className="card space-y-4">
        <h2 className="flex items-center gap-2 font-semibold text-slate-700">
          <UserIcon size={18} /> Mes informations
        </h2>

        <div className="flex items-center gap-4">
          <div className="relative">
            {user?.avatarUrl ? (
              <img
                src={user.avatarUrl}
                alt="Photo de profil"
                className="h-20 w-20 rounded-full object-cover ring-2 ring-slate-100"
              />
            ) : (
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-brand-100 text-2xl font-bold text-brand-700 ring-2 ring-slate-100">
                {(user?.firstName?.[0] ?? user?.fullName?.[0] ?? '?').toUpperCase()}
                {(user?.lastName?.[0] ?? '').toUpperCase()}
              </div>
            )}
            <button
              type="button"
              onClick={() => avatarInputRef.current?.click()}
              disabled={avatarUploading}
              className="absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full border border-white bg-brand-600 text-white shadow hover:bg-brand-700 disabled:opacity-50"
              title="Changer la photo de profil"
            >
              <Camera size={14} />
            </button>
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={onAvatarChange}
            />
          </div>
          <div className="text-sm text-slate-500">
            <p>{avatarUploading ? 'Envoi de la photo…' : 'PNG, JPEG ou WebP, 5 Mo max.'}</p>
            {avatarError && <p className="text-rose-600">{avatarError}</p>}
          </div>
        </div>

        <form onSubmit={saveInfo} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500">Prénom</span>
              <input required className="input" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500">Nom</span>
              <input required className="input" value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500">Téléphone</span>
              <input
                type="tel"
                className="input"
                placeholder="+33 6 12 34 56 78"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500">Email</span>
              <input type="email" required className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={emailNotificationsEnabled}
              onChange={(e) => setEmailNotificationsEnabled(e.target.checked)}
            />
            <Mail size={15} className="text-slate-400" />
            Recevoir les notifications de workflow par email (tâches, processus terminés, compte désactivé)
          </label>

          {infoError && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{infoError}</p>}
          <div className="flex items-center gap-3">
            <button type="submit" className="btn-primary">
              <Save size={16} /> Enregistrer
            </button>
            {infoStatus && <span className="text-sm text-slate-400">{infoStatus}</span>}
          </div>
        </form>
      </div>

      <form onSubmit={save} className="card space-y-4">
        <h2 className="flex items-center gap-2 font-semibold text-slate-700">
          <Users size={18} /> Mes délégations &amp; congés
        </h2>
        <p className="text-sm text-slate-500">
          Si votre compte est désactivé ou que vous êtes en congé sur la période ci-dessous, vos tâches en attente
          seront automatiquement réassignées à votre Suppléant 1, puis à votre Suppléant 2 si celui-ci est
          également indisponible.
        </p>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-500">Suppléant 1 (prioritaire)</span>
          <select className="input" value={delegate1} onChange={(e) => setDelegate1(e.target.value)}>
            <option value="">— aucun —</option>
            {otherUsers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.fullName} ({u.roles.join(', ')})
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-500">Suppléant 2 (backup secondaire)</span>
          <select className="input" value={delegate2} onChange={(e) => setDelegate2(e.target.value)}>
            <option value="">— aucun —</option>
            {otherUsers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.fullName} ({u.roles.join(', ')})
              </option>
            ))}
          </select>
        </label>

        <div className="grid grid-cols-2 gap-4">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">Début de congé</span>
            <input type="date" className="input" value={absenceStart} onChange={(e) => setAbsenceStart(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">Fin de congé</span>
            <input type="date" className="input" value={absenceEnd} onChange={(e) => setAbsenceEnd(e.target.value)} />
          </label>
        </div>

        {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
        <div className="flex items-center gap-3">
          <button type="submit" className="btn-primary">
            <Save size={16} /> Enregistrer
          </button>
          {status && <span className="text-sm text-slate-400">{status}</span>}
        </div>
      </form>

      <form onSubmit={changePassword} className="card space-y-4">
        <h2 className="flex items-center gap-2 font-semibold text-slate-700">
          <KeyRound size={18} /> Changer mon mot de passe
        </h2>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-500">Mot de passe actuel</span>
          <input
            type="password"
            required
            className="input"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-500">Nouveau mot de passe (8 caractères min.)</span>
          <input
            type="password"
            required
            minLength={8}
            className="input"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
        </label>
        {pwError && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{pwError}</p>}
        <div className="flex items-center gap-3">
          <button type="submit" className="btn-primary">
            <Save size={16} /> Mettre à jour
          </button>
          {pwStatus && <span className="text-sm text-slate-400">{pwStatus}</span>}
        </div>
      </form>

      <div className="card space-y-4">
        <h2 className="flex items-center gap-2 font-semibold text-slate-700">
          <ShieldCheck size={18} /> Authentification à deux facteurs (2FA)
        </h2>

        {backupCodes ? (
          <div className="space-y-3">
            <p className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">
              <CheckCircle2 size={16} /> 2FA activée. Notez ces codes de secours dans un endroit sûr : ils ne seront plus
              affichés.
            </p>
            <div className="grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-3 font-mono text-sm text-slate-700">
              {backupCodes.map((code) => (
                <span key={code}>{code}</span>
              ))}
            </div>
            <button onClick={() => setBackupCodes(null)} className="btn-secondary">
              J'ai noté mes codes
            </button>
          </div>
        ) : user?.twoFactorEnabled ? (
          <div className="space-y-3">
            <p className="flex items-center gap-2 text-sm font-medium text-emerald-700">
              <CheckCircle2 size={16} /> La 2FA est activée sur votre compte.
            </p>
            {!disabling ? (
              <button onClick={() => setDisabling(true)} className="flex items-center gap-2 text-sm font-medium text-rose-600 hover:underline">
                <ShieldOff size={14} /> Désactiver la 2FA
              </button>
            ) : (
              <form onSubmit={confirmTwoFactorDisable} className="space-y-3">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-500">Confirmez avec votre mot de passe</span>
                  <input
                    type="password"
                    required
                    autoFocus
                    className="input"
                    value={disablePassword}
                    onChange={(e) => setDisablePassword(e.target.value)}
                  />
                </label>
                {disableError && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{disableError}</p>}
                <div className="flex items-center gap-3">
                  <button type="submit" disabled={twoFactorBusy} className="btn-secondary border-rose-200 text-rose-600 hover:bg-rose-50">
                    {twoFactorBusy ? 'Désactivation…' : 'Confirmer la désactivation'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDisabling(false);
                      setDisablePassword('');
                      setDisableError(null);
                    }}
                    className="text-sm text-slate-500 hover:text-slate-700"
                  >
                    Annuler
                  </button>
                </div>
              </form>
            )}
          </div>
        ) : !twoFactorSetup ? (
          <div className="space-y-3">
            <p className="text-sm text-slate-500">
              Ajoutez une étape de vérification supplémentaire à la connexion via une application d'authentification
              (Google Authenticator, Authy...).
            </p>
            {twoFactorError && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{twoFactorError}</p>}
            <button onClick={startTwoFactorSetup} className="btn-primary">
              <ShieldCheck size={16} /> Activer la 2FA
            </button>
          </div>
        ) : (
          <form onSubmit={confirmTwoFactorEnable} className="space-y-4">
            <p className="text-sm text-slate-500">
              Scannez ce QR code avec votre application d'authentification, puis saisissez le code à 6 chiffres généré
              pour confirmer.
            </p>
            <img src={twoFactorSetup.qrCodeDataUrl} alt="QR code 2FA" className="mx-auto h-40 w-40 rounded-lg border border-slate-200" />
            <p className="text-center font-mono text-xs text-slate-400">{twoFactorSetup.secret}</p>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500">Code à 6 chiffres</span>
              <input
                autoFocus
                required
                className="input text-center font-mono tracking-widest"
                value={twoFactorCode}
                onChange={(e) => setTwoFactorCode(e.target.value)}
                placeholder="123456"
              />
            </label>
            {twoFactorError && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{twoFactorError}</p>}
            <div className="flex items-center gap-3">
              <button type="submit" disabled={twoFactorBusy} className="btn-primary">
                {twoFactorBusy ? 'Vérification…' : 'Confirmer'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setTwoFactorSetup(null);
                  setTwoFactorCode('');
                  setTwoFactorError(null);
                }}
                className="text-sm text-slate-500 hover:text-slate-700"
              >
                Annuler
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
