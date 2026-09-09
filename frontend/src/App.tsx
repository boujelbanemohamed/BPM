import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ProtectedRoute, AdminRoute } from './components/ProtectedRoute';
import { LoginPage } from './pages/LoginPage';
import { ProcessesPage } from './pages/ProcessesPage';
import { ProcessDesignerPage } from './pages/ProcessDesignerPage';
import { PermissionsMatrixPage } from './pages/PermissionsMatrixPage';
import { TasksPage } from './pages/TasksPage';
import { InstancesPage } from './pages/InstancesPage';
import { InstanceDetailPage } from './pages/InstanceDetailPage';
import { NotificationsPage } from './pages/NotificationsPage';
import { ProfilePage } from './pages/ProfilePage';
import { AdminUsersPage } from './pages/AdminUsersPage';
import { AuditPage } from './pages/AuditPage';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="/processes" replace />} />
        <Route path="/processes" element={<ProcessesPage />} />
        <Route path="/processes/:id" element={<ProcessDesignerPage />} />
        <Route
          path="/processes/:id/permissions"
          element={
            <AdminRoute>
              <PermissionsMatrixPage />
            </AdminRoute>
          }
        />
        <Route path="/tasks" element={<TasksPage />} />
        <Route path="/instances" element={<InstancesPage />} />
        <Route path="/instances/:id" element={<InstanceDetailPage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route
          path="/admin/users"
          element={
            <AdminRoute>
              <AdminUsersPage />
            </AdminRoute>
          }
        />
        <Route
          path="/admin/audit"
          element={
            <AdminRoute>
              <AuditPage />
            </AdminRoute>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/processes" replace />} />
    </Routes>
  );
}
