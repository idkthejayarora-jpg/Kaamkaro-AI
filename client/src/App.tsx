import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import Layout from './components/Layout';
import OverdueTaskAlert from './components/OverdueTaskAlert';
import RippleEffect from './components/RippleEffect';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Staff from './pages/Staff';
import StaffProfile from './pages/StaffProfile';
import Customers from './pages/Customers';
import CustomerProfile from './pages/CustomerProfile';
import Vendors from './pages/Vendors';
import Diary from './pages/Diary';
import Tasks from './pages/Tasks';
import Recommendations from './pages/Recommendations';
import AuditLog from './pages/AuditLog';
import Leaderboard from './pages/Leaderboard';
import FollowupQueue from './pages/FollowupQueue';
import Goals from './pages/Goals';
import Templates from './pages/Templates';
import WebhookSetup from './pages/WebhookSetup';
import Chat from './pages/Chat';
import Teams from './pages/Teams';
import CRM from './pages/CRM';
import CRMForm from './pages/CRMForm';
import CRMDetail from './pages/CRMDetail';
import SalesInsights from './pages/SalesInsights';
import Stock from './pages/Stock';
import Badges from './pages/Badges';
import Calendar from './pages/Calendar';
import Settings from './pages/Settings';
import AntiFraud from './pages/AntiFraud';
// Face-recognition pages pull in the heavy @vladmandic/face-api library.
// Lazy-load them so face-api ships as its own on-demand chunk instead of
// bloating the main bundle that every user downloads on first load.
const AttendancePortal = lazy(() => import('./pages/AttendancePortal'));
const AttendanceKiosk  = lazy(() => import('./pages/AttendanceKiosk'));

const RouteFallback = () => (
  <div className="flex items-center justify-center min-h-screen bg-dark-500">
    <div className="w-10 h-10 border-2 border-gold border-t-transparent rounded-full animate-spin" />
  </div>
);

function PrivateRoute({ children, adminOnly = false }: { children: React.ReactNode; adminOnly?: boolean }) {
  const { user, loading } = useAuth();
  if (loading) return (
    <div className="flex items-center justify-center min-h-screen bg-dark-500">
      <div className="flex flex-col items-center gap-4">
        <div className="w-10 h-10 border-2 border-gold border-t-transparent rounded-full animate-spin" />
        <span className="text-white/30 text-sm">Loading…</span>
      </div>
    </div>
  );
  if (!user) return <Navigate to="/login" replace />;
  // attendance_managers can only access attendance-related routes
  if (user.role === 'attendance_manager' && adminOnly) return <Navigate to="/attendance-portal" replace />;
  if (adminOnly && user.role !== 'admin') return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

function AppRoutes() {
  const { user } = useAuth();
  return (
    <Suspense fallback={<RouteFallback />}>
    <Routes>
      {/* Public routes */}
      <Route path="/login" element={user ? (user.role === 'attendance_manager' ? <Navigate to="/attendance-portal" replace /> : <Navigate to="/dashboard" replace />) : <Login />} />
      <Route path="/kiosk" element={<AttendanceKiosk />} />
      <Route path="/" element={<Navigate to={user?.role === 'attendance_manager' ? '/attendance-portal' : '/dashboard'} replace />} />

      <Route element={<PrivateRoute><Layout /></PrivateRoute>}>
        <Route path="/dashboard"       element={<Dashboard />} />
        <Route path="/staff"           element={<PrivateRoute adminOnly><Staff /></PrivateRoute>} />
        <Route path="/staff/:id"       element={<StaffProfile />} />
        <Route path="/customers"       element={<Customers />} />
        <Route path="/customers/:id"   element={<CustomerProfile />} />
        <Route path="/vendors"         element={<Vendors />} />
        <Route path="/diary"           element={<Diary />} />
        <Route path="/tasks"           element={<Tasks />} />
        <Route path="/chat"            element={<Chat />} />
        <Route path="/leaderboard"     element={<Leaderboard />} />
        <Route path="/followup"        element={<FollowupQueue />} />
        <Route path="/goals"           element={<Goals />} />
        <Route path="/recommendations" element={<PrivateRoute adminOnly><Recommendations /></PrivateRoute>} />
        <Route path="/sales-insights"  element={<PrivateRoute adminOnly><SalesInsights /></PrivateRoute>} />
        <Route path="/templates"       element={<Templates />} />
        <Route path="/webhook"         element={<PrivateRoute adminOnly><WebhookSetup /></PrivateRoute>} />
        <Route path="/audit"           element={<PrivateRoute adminOnly><AuditLog /></PrivateRoute>} />
        <Route path="/anti-fraud"      element={<PrivateRoute adminOnly><AntiFraud /></PrivateRoute>} />
        <Route path="/teams"             element={<PrivateRoute adminOnly><Teams /></PrivateRoute>} />
        <Route path="/crm"             element={<CRM />} />
        <Route path="/crm/new"         element={<CRMForm />} />
        <Route path="/crm/:id"         element={<CRMDetail />} />
        <Route path="/crm/:id/edit"    element={<CRMForm />} />
        <Route path="/stock"           element={<Stock />} />
        <Route path="/badges"          element={<Badges />} />
        <Route path="/calendar"        element={<Calendar />} />
        <Route path="/settings"          element={<Settings />} />
        <Route path="/attendance-portal" element={<AttendancePortal />} />
      </Route>
      <Route path="*" element={<Navigate to={user?.role === 'attendance_manager' ? '/attendance-portal' : '/dashboard'} replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <AppRoutes />
          <OverdueTaskAlert />
          <RippleEffect />
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}
