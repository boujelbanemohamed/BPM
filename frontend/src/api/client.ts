import {
  AuditLogEntry,
  ClientItem,
  DatabaseTable,
  DocumentFolder,
  DocumentItem,
  FieldRegistryRow,
  LibraryDocumentItem,
  MinimalUser,
  NotificationItem,
  NotificationTemplate,
  PageAccessLevel,
  PageKey,
  PermissionMatrixRow,
  ProcessDefinition,
  ProcessInstance,
  PublicUser,
  Role,
  RoleWithUsers,
  SmtpSettings,
  TaskItem,
} from '../types';

const TOKEN_KEY = 'bpm_token';
const REFRESH_TOKEN_KEY = 'bpm_refresh_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}

export function setRefreshToken(token: string | null): void {
  if (token) localStorage.setItem(REFRESH_TOKEN_KEY, token);
  else localStorage.removeItem(REFRESH_TOKEN_KEY);
}

export function storeSession(session: { token: string; refreshToken: string }): void {
  setToken(session.token);
  setRefreshToken(session.refreshToken);
}

export function clearSession(): void {
  setToken(null);
  setRefreshToken(null);
}

interface RequestOptions {
  method?: string;
  body?: unknown;
}

// Ces routes gèrent elles-mêmes leurs erreurs 401 (identifiants/code invalides,
// lien expiré...) : ce ne sont pas des signes qu'une session existante a
// expiré, donc elles ne doivent jamais déclencher le rafraîchissement
// automatique ni la redirection vers /login.
const AUTH_ENTRY_POINTS = [
  '/auth/login',
  '/auth/2fa/verify-login',
  '/auth/refresh',
  '/auth/forgot-password',
  '/auth/reset-password',
];

let refreshPromise: Promise<boolean> | null = null;

async function performRefresh(): Promise<boolean> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;
  try {
    const res = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { token: string; refreshToken: string };
    storeSession(data);
    return true;
  } catch {
    return false;
  }
}

/** Un seul appel /auth/refresh en vol même si plusieurs requêtes 401 arrivent en même temps. */
function refreshSession(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = performRefresh().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

async function request<T>(path: string, options: RequestOptions = {}, retried = false): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`/api${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (res.status === 401 && !AUTH_ENTRY_POINTS.includes(path)) {
    if (!retried && (await refreshSession())) {
      return request<T>(path, options, true);
    }
    clearSession();
    window.location.href = '/login';
    throw new Error('Session expirée');
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `Erreur ${res.status}`);
  }
  return data as T;
}

type LoginResult =
  | { requiresTwoFactor: true; pendingToken: string }
  | { requiresTwoFactor?: false; token: string; refreshToken: string; user: PublicUser; pageAccess: Record<PageKey, PageAccessLevel> };

export const api = {
  login: (email: string, password: string) =>
    request<LoginResult>('/auth/login', { method: 'POST', body: { email, password } }),
  verifyTwoFactorLogin: (pendingToken: string, code: string) =>
    request<{ token: string; refreshToken: string; user: PublicUser; pageAccess: Record<PageKey, PageAccessLevel> }>(
      '/auth/2fa/verify-login',
      { method: 'POST', body: { pendingToken, code } }
    ),
  logout: async (): Promise<void> => {
    const refreshToken = getRefreshToken();
    try {
      await request<{ ok: true }>('/auth/logout', { method: 'POST', body: { refreshToken: refreshToken ?? undefined } });
    } catch {
      // best-effort : la session locale est nettoyée quoi qu'il arrive
    }
  },
  forgotPassword: (email: string) => request<{ ok: true }>('/auth/forgot-password', { method: 'POST', body: { email } }),
  resetPassword: (token: string, newPassword: string) =>
    request<{ ok: true }>('/auth/reset-password', { method: 'POST', body: { token, newPassword } }),
  me: () => request<{ user: PublicUser; pageAccess: Record<PageKey, PageAccessLevel> }>('/auth/me'),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ ok: true }>('/auth/me/password', { method: 'PUT', body: { currentPassword, newPassword } }),
  setupTwoFactor: () => request<{ secret: string; qrCodeDataUrl: string }>('/auth/2fa/setup'),
  enableTwoFactor: (code: string) =>
    request<{ ok: true; backupCodes: string[] }>('/auth/2fa/enable', { method: 'POST', body: { code } }),
  disableTwoFactor: (password: string) =>
    request<{ ok: true }>('/auth/2fa/disable', { method: 'POST', body: { password } }),

  updateMyProfile: (payload: {
    firstName: string;
    lastName: string;
    phone: string | null;
    email: string;
    emailNotificationsEnabled?: boolean;
  }) => request<{ user: PublicUser }>('/users/me', { method: 'PUT', body: payload }),
  uploadMyAvatar: async (file: File): Promise<{ user: PublicUser }> => {
    const formData = new FormData();
    formData.append('avatar', file);
    const token = getToken();
    const res = await fetch('/api/users/me/avatar', {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: formData,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data as { error?: string }).error || `Erreur ${res.status}`);
    return data as { user: PublicUser };
  },

  listRoles: () => request<{ roles: Role[] }>('/roles'),
  listRolesOverview: () => request<{ roles: RoleWithUsers[] }>('/roles/overview'),
  createRole: (payload: { name: string; description?: string }) =>
    request<{ role: Role }>('/roles', { method: 'POST', body: payload }),
  updateRole: (id: number, payload: { description: string | null }) =>
    request<{ role: Role }>(`/roles/${id}`, { method: 'PUT', body: payload }),
  updateRolePageAccess: (id: number, pageAccess: Record<PageKey, PageAccessLevel>) =>
    request<{ ok: true }>(`/roles/${id}/page-access`, { method: 'PUT', body: { pageAccess } }),
  listUsersMinimal: () => request<{ users: MinimalUser[] }>('/users'),
  getMyDelegation: () => request<{ delegation: PublicUser }>('/users/me/delegation'),
  updateMyDelegation: (payload: {
    delegateUser1Id: string | null;
    delegateUser2Id: string | null;
    absenceStart: string | null;
    absenceEnd: string | null;
  }) => request<{ delegation: PublicUser }>('/users/me/delegation', { method: 'PUT', body: payload }),

  adminListUsers: () => request<{ users: PublicUser[] }>('/admin/users'),
  adminCreateUser: (payload: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    phone?: string | null;
    roleNames: string[];
  }) => request<{ user: PublicUser }>('/admin/users', { method: 'POST', body: payload }),
  adminUpdateUser: (
    id: string,
    payload: Partial<{
      firstName: string;
      lastName: string;
      phone: string | null;
      email: string;
      password: string;
      roleNames: string[];
      delegateUser1Id: string | null;
      delegateUser2Id: string | null;
      absenceStart: string | null;
      absenceEnd: string | null;
    }>
  ) => request<{ user: PublicUser }>(`/admin/users/${id}`, { method: 'PUT', body: payload }),
  adminDeactivateUser: (id: string) =>
    request<{ user: PublicUser; reassignedTasks: number }>(`/admin/users/${id}/deactivate`, { method: 'POST' }),
  adminActivateUser: (id: string) =>
    request<{ user: PublicUser }>(`/admin/users/${id}/activate`, { method: 'POST' }),
  importUsersCsv: async (
    file: File
  ): Promise<{
    created: number;
    updated: number;
    results: Array<{ row: number; email: string; action: 'created' | 'updated' }>;
    errors: Array<{ row: number; email?: string; message: string }>;
  }> => {
    const formData = new FormData();
    formData.append('file', file);
    const token = getToken();
    const res = await fetch('/api/admin/users/import', {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: formData,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data as { error?: string }).error || `Erreur ${res.status}`);
    return data;
  },
  downloadUsersCsvTemplate: async (): Promise<void> => {
    const token = getToken();
    const res = await fetch('/api/admin/users/import-template', {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (!res.ok) throw new Error(`Échec du téléchargement (${res.status})`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'modele_import_utilisateurs.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  },

  listProcesses: () => request<{ processes: ProcessDefinition[] }>('/processes'),
  getProcess: (id: string) => request<{ process: ProcessDefinition }>(`/processes/${id}`),
  createProcess: (payload: {
    name: string;
    version?: number;
    description?: string;
    bpmnXml?: string;
    attachedFolderId?: string;
    attachedDocumentId?: string;
  }) => request<{ process: ProcessDefinition }>('/processes', { method: 'POST', body: payload }),
  updateProcess: (
    id: string,
    payload: {
      name?: string;
      description?: string;
      bpmnXml?: string;
      reference?: string;
      version?: number;
      attachedFolderId?: string | null;
      attachedDocumentId?: string | null;
    }
  ) => request<{ process: ProcessDefinition }>(`/processes/${id}`, { method: 'PUT', body: payload }),
  publishProcess: (id: string) => request<{ process: ProcessDefinition }>(`/processes/${id}/publish`, { method: 'POST' }),
  archiveProcess: (id: string) => request<{ process: ProcessDefinition }>(`/processes/${id}/archive`, { method: 'POST' }),
  duplicateProcess: (id: string) => request<{ process: ProcessDefinition }>(`/processes/${id}/duplicate`, { method: 'POST' }),
  deleteProcess: (id: string) => request<{ ok: true }>(`/processes/${id}/delete`, { method: 'POST' }),
  listProcessTrash: () => request<{ processes: ProcessDefinition[] }>('/processes/trash'),
  restoreProcess: (id: string) => request<{ process: ProcessDefinition }>(`/processes/${id}/restore`, { method: 'POST' }),
  permanentlyDeleteProcess: (id: string) => request<{ ok: true }>(`/processes/${id}/permanent`, { method: 'DELETE' }),
  getPermissions: (processId: string) =>
    request<{ permissions: PermissionMatrixRow[] }>(`/processes/${processId}/permissions`),
  putPermissions: (
    processId: string,
    rows: Array<{
      stepName: string;
      roleId: number;
      fieldPermissions: Record<string, { read: boolean; write: boolean }>;
      canViewDocuments: boolean;
      canUploadDocuments: boolean;
    }>
  ) => request<{ permissions: PermissionMatrixRow[] }>(`/processes/${processId}/permissions`, { method: 'PUT', body: { rows } }),

  importProcessesXml: async (
    files: File[]
  ): Promise<{
    created: number;
    results: Array<{ file: string; processId: string; name: string }>;
    errors: Array<{ file: string; message: string }>;
  }> => {
    const formData = new FormData();
    files.forEach((f) => formData.append('files', f));
    const token = getToken();
    const res = await fetch('/api/processes/import', {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: formData,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data as { error?: string }).error || `Erreur ${res.status}`);
    return data;
  },
  downloadProcessImportTemplate: async (): Promise<void> => {
    const token = getToken();
    const res = await fetch('/api/processes/import-template', {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (!res.ok) throw new Error(`Échec du téléchargement (${res.status})`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'modele_import_processus.xml';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  },

  startInstance: (processId: string, formData: Record<string, unknown> = {}) =>
    request<{ instance: ProcessInstance }>(`/instances/processes/${processId}/start`, {
      method: 'POST',
      body: { formData },
    }),
  listInstances: () => request<{ instances: ProcessInstance[] }>('/instances'),
  getInstance: (id: string) =>
    request<{ instance: ProcessInstance; tasks: TaskItem[]; events: AuditLogEntry[] }>(`/instances/${id}`),

  myTasks: () => request<{ tasks: TaskItem[] }>('/tasks/my-tasks'),
  completeTask: (id: string, formData: Record<string, unknown>) =>
    request<{ instance: ProcessInstance }>(`/tasks/${id}/complete`, { method: 'POST', body: { formData } }),

  listDocuments: (instanceId: string) => request<{ documents: DocumentItem[] }>(`/documents/instances/${instanceId}/documents`),
  uploadDocument: async (instanceId: string, file: File, taskId?: string): Promise<{ document: DocumentItem }> => {
    const formData = new FormData();
    formData.append('file', file);
    if (taskId) formData.append('taskId', taskId);
    const token = getToken();
    const res = await fetch(`/api/documents/instances/${instanceId}/documents`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: formData,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data as { error?: string }).error || `Erreur ${res.status}`);
    return data as { document: DocumentItem };
  },
  downloadDocument: async (id: string, filename: string): Promise<void> => {
    const token = getToken();
    const res = await fetch(`/api/documents/${id}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (!res.ok) throw new Error(`Échec du téléchargement (${res.status})`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  },
  viewDocument: async (id: string): Promise<void> => {
    // Ouvre l'onglet immédiatement (dans le geste utilisateur du clic) pour
    // éviter le blocage popup, puis y charge le fichier une fois récupéré.
    // Remarque : "noopener" ferait retourner null à window.open(), on ne
    // pourrait alors plus naviguer cet onglet déjà ouvert.
    const newTab = window.open('', '_blank');
    const token = getToken();
    try {
      const res = await fetch(`/api/documents/${id}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!res.ok) throw new Error(`Échec de l'ouverture (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      if (newTab) newTab.location.href = url;
      else window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      newTab?.close();
      throw err;
    }
  },

  listFolders: () => request<{ folders: DocumentFolder[] }>('/library/folders'),
  createFolder: (name: string) => request<{ folder: DocumentFolder }>('/library/folders', { method: 'POST', body: { name } }),
  listAllLibraryDocuments: () => request<{ documents: LibraryDocumentItem[] }>('/library/documents'),
  getFolder: (id: string) =>
    request<{ folder: DocumentFolder; documents: LibraryDocumentItem[] }>(`/library/folders/${id}`),
  uploadLibraryDocument: async (folderId: string, file: File): Promise<{ document: LibraryDocumentItem }> => {
    const formData = new FormData();
    formData.append('file', file);
    const token = getToken();
    const res = await fetch(`/api/library/folders/${folderId}/documents`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: formData,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data as { error?: string }).error || `Erreur ${res.status}`);
    return data as { document: LibraryDocumentItem };
  },
  downloadLibraryDocument: async (id: string, filename: string): Promise<void> => {
    const token = getToken();
    const res = await fetch(`/api/library/documents/${id}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (!res.ok) throw new Error(`Échec du téléchargement (${res.status})`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  },
  viewLibraryDocument: async (id: string): Promise<void> => {
    const newTab = window.open('', '_blank');
    const token = getToken();
    try {
      const res = await fetch(`/api/library/documents/${id}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!res.ok) throw new Error(`Échec de l'ouverture (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      if (newTab) newTab.location.href = url;
      else window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      newTab?.close();
      throw err;
    }
  },

  listNotifications: () => request<{ notifications: NotificationItem[] }>('/notifications'),
  unreadCount: () => request<{ count: number }>('/notifications/unread-count'),
  markNotificationRead: (id: string) => request<{ notification: NotificationItem }>(`/notifications/${id}/read`, { method: 'POST' }),
  markAllNotificationsRead: () => request<{ ok: true }>('/notifications/read-all', { method: 'POST' }),

  listAuditLogs: (params: { userId?: string; action?: string; entityType?: string; limit?: number; offset?: number } = {}) => {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) query.set(key, String(value));
    });
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return request<{ logs: AuditLogEntry[]; total: number }>(`/audit${suffix}`);
  },

  listClients: (q = '') => request<{ clients: ClientItem[] }>(`/clients${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  getClient: (id: string) => request<{ client: ClientItem; instances: ProcessInstance[] }>(`/clients/${id}`),
  createClient: (payload: { name: string; email?: string; phone?: string; address?: string; notes?: string }) =>
    request<{ client: ClientItem }>('/clients', { method: 'POST', body: payload }),
  updateClient: (
    id: string,
    payload: Partial<{ name: string; email: string; phone: string; address: string; notes: string }>
  ) => request<{ client: ClientItem }>(`/clients/${id}`, { method: 'PUT', body: payload }),

  listFieldsRegistry: () => request<{ fields: FieldRegistryRow[] }>('/admin/fields'),
  getDatabaseSchema: () => request<{ tables: DatabaseTable[] }>('/admin/database-schema'),

  getSmtpSettings: () => request<{ settings: SmtpSettings }>('/admin/smtp'),
  updateSmtpSettings: (payload: {
    host: string;
    port: number;
    secure: boolean;
    username?: string;
    password?: string;
    fromAddress?: string;
  }) => request<{ ok: true }>('/admin/smtp', { method: 'PUT', body: payload }),
  sendSmtpTestEmail: () => request<{ ok: true }>('/admin/smtp/test', { method: 'POST' }),

  listNotificationTemplates: () => request<{ templates: NotificationTemplate[] }>('/admin/notification-templates'),
  updateNotificationTemplate: (key: string, payload: { heading: string; subject: string; bodyHtml: string }) =>
    request<{ template: NotificationTemplate }>(`/admin/notification-templates/${key}`, {
      method: 'PUT',
      body: payload,
    }),
  resetNotificationTemplate: (key: string) =>
    request<{ template: NotificationTemplate }>(`/admin/notification-templates/${key}/reset`, { method: 'POST' }),
  previewNotificationTemplate: (key: string, payload: { heading: string; subject: string; bodyHtml: string }) =>
    request<{ subject: string; html: string }>(`/admin/notification-templates/${key}/preview`, {
      method: 'POST',
      body: payload,
    }),
};
