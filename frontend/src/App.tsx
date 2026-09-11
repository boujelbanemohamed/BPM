import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ProtectedRoute, RequirePageAccess } from './components/ProtectedRoute';
import { LoginPage } from './pages/LoginPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { ProcessesPage } from './pages/ProcessesPage';
import { ProcessTrashPage } from './pages/ProcessTrashPage';
import { ProcessDesignerPage } from './pages/ProcessDesignerPage';
import { PermissionsMatrixPage } from './pages/PermissionsMatrixPage';
import { TasksPage } from './pages/TasksPage';
import { InstancesPage } from './pages/InstancesPage';
import { InstanceDetailPage } from './pages/InstanceDetailPage';
import { NotificationsPage } from './pages/NotificationsPage';
import { ProfilePage } from './pages/ProfilePage';
import { AdminUsersPage } from './pages/AdminUsersPage';
import { AuditPage } from './pages/AuditPage';
import { ClientsPage } from './pages/ClientsPage';
import { ClientDetailPage } from './pages/ClientDetailPage';
import { DocumentsPage } from './pages/DocumentsPage';
import { DocumentFolderPage } from './pages/DocumentFolderPage';
import { FieldsRegistryPage } from './pages/FieldsRegistryPage';
import { DatabaseSchemaPage } from './pages/DatabaseSchemaPage';
import { AdminNotificationsPage } from './pages/AdminNotificationsPage';
import { RolesPage } from './pages/RolesPage';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="/processes" replace />} />
        <Route path="/processes" element={<ProcessesPage />} />
        <Route path="/processes/trash" element={<ProcessTrashPage />} />
        <Route path="/processes/:id" element={<ProcessDesignerPage />} />
        <Route
          path="/processes/:id/permissions"
          element={
            <RequirePageAccess pageKey="PERMISSIONS_MATRIX" minLevel="VIEW">
              <PermissionsMatrixPage />
            </RequirePageAccess>
          }
        />
        <Route path="/tasks" element={<TasksPage />} />
        <Route path="/instances" element={<InstancesPage />} />
        <Route path="/instances/:id" element={<InstanceDetailPage />} />
        <Route path="/clients" element={<ClientsPage />} />
        <Route path="/clients/:id" element={<ClientDetailPage />} />
        <Route
          path="/documents"
          element={
            <RequirePageAccess pageKey="DOCUMENTS" minLevel="VIEW">
              <DocumentsPage />
            </RequirePageAccess>
          }
        />
        <Route
          path="/documents/:id"
          element={
            <RequirePageAccess pageKey="DOCUMENTS" minLevel="VIEW">
              <DocumentFolderPage />
            </RequirePageAccess>
          }
        />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route
          path="/admin/users"
          element={
            <RequirePageAccess pageKey="USERS" minLevel="VIEW">
              <AdminUsersPage />
            </RequirePageAccess>
          }
        />
        <Route
          path="/admin/audit"
          element={
            <RequirePageAccess pageKey="AUDIT" minLevel="VIEW">
              <AuditPage />
            </RequirePageAccess>
          }
        />
        <Route
          path="/admin/fields"
          element={
            <RequirePageAccess pageKey="FIELDS_REGISTRY" minLevel="VIEW">
              <FieldsRegistryPage />
            </RequirePageAccess>
          }
        />
        <Route
          path="/admin/database"
          element={
            <RequirePageAccess pageKey="DATABASE" minLevel="VIEW">
              <DatabaseSchemaPage />
            </RequirePageAccess>
          }
        />
        <Route
          path="/admin/notifications"
          element={
            <RequirePageAccess pageKey="NOTIFICATIONS_CONFIG" minLevel="VIEW">
              <AdminNotificationsPage />
            </RequirePageAccess>
          }
        />
        <Route
          path="/admin/roles"
          element={
            <RequirePageAccess pageKey="ROLES" minLevel="VIEW">
              <RolesPage />
            </RequirePageAccess>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/processes" replace />} />
    </Routes>
  );
}
