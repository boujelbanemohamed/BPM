export type ProcessStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
export type InstanceStatus = 'RUNNING' | 'COMPLETED' | 'CANCELLED';
export type TaskStatus = 'PENDING' | 'COMPLETED' | 'CANCELLED';
export type NotificationType =
  | 'TASK_ASSIGNED'
  | 'TASK_DELEGATED'
  | 'TASK_REASSIGNED'
  | 'PROCESS_COMPLETED'
  | 'ACCOUNT_DEACTIVATED'
  | 'GENERIC';

export type PageAccessLevel = 'NONE' | 'VIEW' | 'FULL';

export const PAGE_KEYS = [
  'PROCESSES_DESIGN',
  'PERMISSIONS_MATRIX',
  'USERS',
  'AUDIT',
  'DATABASE',
  'FIELDS_REGISTRY',
  'NOTIFICATIONS_CONFIG',
  'ROLES',
] as const;

export type PageKey = (typeof PAGE_KEYS)[number];

export interface Role {
  id: number;
  name: string;
  description: string | null;
}

export interface RoleUserSummary {
  id: string;
  fullName: string;
  email: string;
  isActive: boolean;
}

export interface RoleAssignedTask {
  processId: string;
  processName: string;
  processStatus: ProcessStatus;
  stepName: string;
}

export interface RolePermissionRule {
  processId: string;
  processName: string;
  stepName: string;
  fieldCount: number;
  canViewDocuments: boolean;
  canUploadDocuments: boolean;
}

export interface RoleWithUsers extends Role {
  users: RoleUserSummary[];
  assignedTasks: RoleAssignedTask[];
  permissionRules: RolePermissionRule[];
  pageAccess: Record<PageKey, PageAccessLevel>;
}

export interface User {
  id: string;
  email: string;
  password_hash: string;
  full_name: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  avatar_url: string | null;
  email_notifications_enabled: boolean;
  is_active: boolean;
  absence_start: string | null;
  absence_end: string | null;
  delegate_user_1_id: string | null;
  delegate_user_2_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface PublicUser {
  id: string;
  email: string;
  fullName: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  avatarUrl: string | null;
  emailNotificationsEnabled: boolean;
  isActive: boolean;
  absenceStart: string | null;
  absenceEnd: string | null;
  delegateUser1Id: string | null;
  delegateUser2Id: string | null;
  roles: string[];
}

export interface AuthenticatedUser extends PublicUser {
  roleIds: number[];
}

export interface FormField {
  key: string;
  label: string;
  type: 'text' | 'number' | 'boolean' | 'date' | 'textarea' | 'client';
  required: boolean;
}

export interface ClientRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProcessRow {
  id: string;
  process_key: string;
  reference: string;
  name: string;
  description: string | null;
  bpmn_xml: string;
  version: number;
  status: ProcessStatus;
  created_by: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  deleted_by: string | null;
}

export interface ProcessInstanceRow {
  id: string;
  process_id: string;
  client_id: string | null;
  status: InstanceStatus;
  current_step_name: string | null;
  current_element_id: string | null;
  form_data: Record<string, unknown>;
  started_by: string;
  started_at: string;
  completed_at: string | null;
}

export interface TaskRow {
  id: string;
  instance_id: string;
  element_id: string;
  step_name: string;
  status: TaskStatus;
  original_assignee_id: string | null;
  effective_assignee_id: string | null;
  assignee_role_id: number | null;
  is_delegated: boolean;
  form_schema: FormField[];
  form_data: Record<string, unknown> | null;
  created_at: string;
  completed_at: string | null;
  completed_by: string | null;
}

export interface DocumentRow {
  id: string;
  instance_id: string;
  task_id: string | null;
  filename: string;
  mime_type: string;
  size_bytes: number;
  storage_path: string;
  uploaded_by: string;
  uploaded_at: string;
}

export interface PermissionMatrixRow {
  id: string;
  process_id: string;
  step_name: string;
  role_id: number;
  field_permissions: Record<string, { read: boolean; write: boolean }>;
  can_view_documents: boolean;
  can_upload_documents: boolean;
}

export interface AuditLogRow {
  id: string;
  user_id: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  details: Record<string, unknown>;
  ip_address: string | null;
  created_at: string;
}

export interface SmtpSettingsRow {
  id: number;
  host: string | null;
  port: number;
  secure: boolean;
  username: string | null;
  password: string | null;
  from_address: string | null;
  updated_at: string;
  updated_by: string | null;
}

export interface NotificationTemplateRow {
  key: string;
  heading: string;
  subject: string;
  body_html: string;
  variables: string[];
  updated_at: string;
  updated_by: string | null;
}

export interface NotificationRow {
  id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  message: string;
  link: string | null;
  is_read: boolean;
  created_at: string;
}
