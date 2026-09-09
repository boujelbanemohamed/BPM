import {
  AuditLogEntry,
  ClientItem,
  DocumentItem,
  MinimalUser,
  NotificationItem,
  PermissionMatrixRow,
  ProcessDefinition,
  ProcessInstance,
  PublicUser,
  Role,
  TaskItem,
} from '../types';

const TOKEN_KEY = 'bpm_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

interface RequestOptions {
  method?: string;
  body?: unknown;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`/api${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (res.status === 401) {
    setToken(null);
    window.location.href = '/login';
    throw new Error('Session expirée');
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `Erreur ${res.status}`);
  }
  return data as T;
}

export const api = {
  login: (email: string, password: string) =>
    request<{ token: string; user: PublicUser }>('/auth/login', { method: 'POST', body: { email, password } }),
  me: () => request<{ user: PublicUser }>('/auth/me'),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ ok: true }>('/auth/me/password', { method: 'PUT', body: { currentPassword, newPassword } }),

  listRoles: () => request<{ roles: Role[] }>('/roles'),
  listUsersMinimal: () => request<{ users: MinimalUser[] }>('/users'),
  getMyDelegation: () => request<{ delegation: PublicUser }>('/users/me/delegation'),
  updateMyDelegation: (payload: {
    delegateUser1Id: string | null;
    delegateUser2Id: string | null;
    absenceStart: string | null;
    absenceEnd: string | null;
  }) => request<{ delegation: PublicUser }>('/users/me/delegation', { method: 'PUT', body: payload }),

  adminListUsers: () => request<{ users: PublicUser[] }>('/admin/users'),
  adminCreateUser: (payload: { email: string; password: string; fullName: string; roleNames: string[] }) =>
    request<{ user: PublicUser }>('/admin/users', { method: 'POST', body: payload }),
  adminUpdateUser: (
    id: string,
    payload: Partial<{
      fullName: string;
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

  listProcesses: () => request<{ processes: ProcessDefinition[] }>('/processes'),
  getProcess: (id: string) => request<{ process: ProcessDefinition }>(`/processes/${id}`),
  createProcess: (payload: { name: string; description?: string; bpmnXml?: string }) =>
    request<{ process: ProcessDefinition }>('/processes', { method: 'POST', body: payload }),
  updateProcess: (id: string, payload: { name?: string; description?: string; bpmnXml?: string }) =>
    request<{ process: ProcessDefinition }>(`/processes/${id}`, { method: 'PUT', body: payload }),
  publishProcess: (id: string) => request<{ process: ProcessDefinition }>(`/processes/${id}/publish`, { method: 'POST' }),
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
};
