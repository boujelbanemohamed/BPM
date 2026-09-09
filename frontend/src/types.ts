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

export interface Role {
  id: number;
  name: string;
  description: string | null;
}

export interface PublicUser {
  id: string;
  email: string;
  fullName: string;
  isActive: boolean;
  absenceStart: string | null;
  absenceEnd: string | null;
  delegateUser1Id: string | null;
  delegateUser2Id: string | null;
  roles: string[];
}

export interface MinimalUser {
  id: string;
  fullName: string;
  email: string;
  roles: string[];
  isActive: boolean;
}

export interface FormField {
  key: string;
  label: string;
  type: 'text' | 'number' | 'boolean' | 'date' | 'textarea' | 'client';
  required: boolean;
}

export interface ClientItem {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  instance_count?: string;
}

export interface ProcessDefinition {
  id: string;
  process_key: string;
  name: string;
  description: string | null;
  bpmn_xml: string;
  version: number;
  status: ProcessStatus;
  created_by: string;
  created_by_name?: string;
  created_at: string;
  updated_at: string;
}

export interface ProcessInstance {
  id: string;
  process_id: string;
  client_id: string | null;
  process_name?: string;
  started_by_name?: string;
  status: InstanceStatus;
  current_step_name: string | null;
  current_element_id: string | null;
  form_data: Record<string, unknown>;
  started_by: string;
  started_at: string;
  completed_at: string | null;
}

export interface TaskItem {
  id: string;
  instance_id: string;
  element_id: string;
  step_name: string;
  status: TaskStatus;
  original_assignee_id: string | null;
  effective_assignee_id: string | null;
  effective_assignee_name?: string | null;
  assignee_role_id: number | null;
  role_name?: string | null;
  is_delegated: boolean;
  form_schema: FormField[];
  form_data: Record<string, unknown> | null;
  created_at: string;
  completed_at: string | null;
  completed_by: string | null;
  completed_by_name?: string | null;
  process_name?: string;
  is_pool_task?: boolean;
  instance_form_data?: Record<string, unknown>;
}

export interface DocumentItem {
  id: string;
  instance_id: string;
  task_id: string | null;
  filename: string;
  mime_type: string;
  size_bytes: number;
  storage_path: string;
  uploaded_by: string;
  uploaded_by_name?: string;
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

export interface AuditLogEntry {
  id: string;
  user_id: string | null;
  actor_name: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  details: Record<string, unknown>;
  ip_address: string | null;
  created_at: string;
}

export interface NotificationItem {
  id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  message: string;
  link: string | null;
  is_read: boolean;
  created_at: string;
}
