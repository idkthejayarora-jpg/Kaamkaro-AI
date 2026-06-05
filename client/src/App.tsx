import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import Layout from './components/Layout';
import OverdueTaskAlert from './components/OverdueTaskAlert';
import RippleEffect from './components/RippleEffect';

// ── Lazy-load every page so each only downloads when first visited ─────────────
// This drops the initial JS download from ~1.3 MB → ~250 KB gzip,
// which is the primary reason the app was slow to open on phones.
const Login           = lazy(() => import('./pages/Login'));
const Dashboard       = lazy(() => import('./pages/Dashboard'));
const Staff           = lazy(() => import('./pages/Staff'));
const StaffProfile    = lazy(() => import('./pages/StaffProfile'));
const Customers       = lazy(() => import('./pages/Customers'));
const CustomerProfile = lazy(() => import('./pages/CustomerProfile'));
const Vendors         = lazy(() => import('./pages/Vendors'));
const Diary           = lazy(() => import('./pages/Diary'));
const Tasks           = lazy(() => import('./pages/Tasks'));
const Chat            = lazy(() => import('./pages/Chat'));
const Leaderboard     = lazy(() => import('./pages/Leaderboard'));
const FollowupQueue   = lazy(() => import('./pages/FollowupQueue'));
const Goals           = lazy(() => import('./pages/Goals'));
const Recommendations = lazy(() => import('./pages/Recommendations'));
const SalesInsights   = lazy(() => import('./pages/SalesInsights'));
const Templates       = lazy(() => import('./pages/Templates'));
const WebhookSetup    = lazy(() => import('./pages/WebhookSetup'));
const AuditLog        = lazy(() => import('./pages/AuditLog'));
const AntiFraud       = lazy(() => import('./pages/AntiFraud'));
const Teams           = lazy(() => import('./pages/Teams'));
const CRM             = lazy(() => import('./pages/CRM'));
const CRMForm         = lazy(() => import('./pages/CRMForm'));
const CRMDetail       = lazy(() => import('./pages/CRMDetail'));
const Stock           = lazy(() => import('./pages/Stock'));
const Badges          = lazy(() => import('./pages/Badges'));
const Calendar        = lazy(() => import('./pages/Calendar'));
const Settings        = lazy(() => import('./pages/Settings'));
// Face-recognition pages: their own chunk (heavy face-api lib)
const AttendancePortal = lazy(() => import('./pages/AttendancePortal'));
const AttendanceKiosk  = lazy(() => import('./pages/AttendanceKiosk'));

// Lightweight spinner shown while a chunk is fetching (first visit to a route).
// Keeps the shell (sidebar, nav) visible; only the content area shows the spinner.
const PageFallback = () => (
  <div className="flex items-center justify-center h-64">
    <div className="w-8 h-8 border-2 border-gold border-t-transparent rounded-full animate-spin" />
  </div>
);

// Full-screen fallback for login / kiosk (no layout shell yet)
const ScreenFallback = () => (
  <div className="flex items-center justify-center min-h-screen bg-dark-500">
    <div className="flex flex-col items-center gap-4">
      <div className="w-10 h-10 border-2 border-gold border-t-transparent rounded-full animate-spin" />
      <span className="text-white/30 text-sm">Loading…</span>
    </div>
  </div>
);

function PrivateRoute({ children, adminOnly = false }: { children: React.ReactNode; adminOnly?: boolean }) {
  const { user, loading } = useAuth();
  if (loading) return <ScreenFallback />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === 'attendance_manager' && adminOnly) return <Navigate to="/attendance-portal" replace />;
  if (adminOnly && user.role !== 'admin') return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

function AppRoutes() {
  const { user } = useAuth();
  return (
    <Routes>
      {/* Public — full-screen fallback while chunk loads */}
      <Route path="/login" element={
        <Suspense fallback={<ScreenFallback />}>
          {user ? (user.role === 'attendance_manager' ? <Navigate to="/attendance-portal" replace /> : <Navigate to="/dashboard" replace />) : <Login />}
        </Suspense>
      } />
      <Route path="/kiosk" element={
        <Suspense fallback={<ScreenFallback />}>
          <AttendanceKiosk />
        </Suspense>
      } />
      <Route path="/" element={<Navigate to={user?.role === 'attendance_manager' ? '/attendance-portal' : '/dashboard'} replace />} />

      {/* Authenticated shell — sidebar + header stay mounted; only page content suspends */}
      <Route element={<PrivateRoute><Layout /></PrivateRoute>}>
        <Route path="/dashboard"       element={<Suspense fallback={<PageFallback />}><Dashboard /></Suspense>} />
        <Route path="/staff"           element={<Suspense fallback={<PageFallback />}><PrivateRoute adminOnly><Staff /></PrivateRoute></Suspense>} />
        <Route path="/staff/:id"       element={<Suspense fallback={<PageFallback />}><StaffProfile /></Suspense>} />
        <Route path="/customers"       element={<Suspense fallback={<PageFallback />}><Customers /></Suspense>} />
        <Route path="/customers/:id"   element={<Suspense fallback={<PageFallback />}><CustomerProfile /></Suspense>} />
        <Route path="/vendors"         element={<Suspense fallback={<PageFallback />}><Vendors /></Suspense>} />
        <Route path="/diary"           element={<Suspense fallback={<PageFallback />}><Diary /></Suspense>} />
        <Route path="/tasks"           element={<Suspense fallback={<PageFallback />}><Tasks /></Suspense>} />
        <Route path="/chat"            element={<Suspense fallback={<PageFallback />}><Chat /></Suspense>} />
        <Route path="/leaderboard"     element={<Suspense fallback={<PageFallback />}><Leaderboard /></Suspense>} />
        <Route path="/followup"        element={<Suspense fallback={<PageFallback />}><FollowupQueue /></Suspense>} />
        <Route path="/goals"           element={<Suspense fallback={<PageFallback />}><Goals /></Suspense>} />
        <Route path="/recommendations" element={<Suspense fallback={<PageFallback />}><PrivateRoute adminOnly><Recommendations /></PrivateRoute></Suspense>} />
        <Route path="/sales-insights"  element={<Suspense fallback={<PageFallback />}><PrivateRoute adminOnly><SalesInsights /></PrivateRoute></Suspense>} />
        <Route path="/templates"       element={<Suspense fallback={<PageFallback />}><Templates /></Suspense>} />
        <Route path="/webhook"         element={<Suspense fallback={<PageFallback />}><PrivateRoute adminOnly><WebhookSetup /></PrivateRoute></Suspense>} />
        <Route path="/audit"           element={<Suspense fallback={<PageFallback />}><PrivateRoute adminOnly><AuditLog /></PrivateRoute></Suspense>} />
        <Route path="/anti-fraud"      element={<Suspense fallback={<PageFallback />}><PrivateRoute adminOnly><AntiFraud /></PrivateRoute></Suspense>} />
        <Route path="/teams"           element={<Suspense fallback={<PageFallback />}><PrivateRoute adminOnly><Teams /></PrivateRoute></Suspense>} />
        <Route path="/crm"             element={<Suspense fallback={<PageFallback />}><CRM /></Suspense>} />
        <Route path="/crm/new"         element={<Suspense fallback={<PageFallback />}><CRMForm /></Suspense>} />
        <Route path="/crm/:id"         element={<Suspense fallback={<PageFallback />}><CRMDetail /></Suspense>} />
        <Route path="/crm/:id/edit"    element={<Suspense fallback={<PageFallback />}><CRMForm /></Suspense>} />
        <Route path="/stock"           element={<Suspense fallback={<PageFallback />}><Stock /></Suspense>} />
        <Route path="/badges"          element={<Suspense fallback={<PageFallback />}><Badges /></Suspense>} />
        <Route path="/calendar"        element={<Suspense fallback={<PageFallback />}><Calendar /></Suspense>} />
        <Route path="/settings"        element={<Suspense fallback={<PageFallback />}><Settings /></Suspense>} />
        <Route path="/attendance-portal" element={<Suspense fallback={<PageFallback />}><AttendancePortal /></Suspense>} />
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
