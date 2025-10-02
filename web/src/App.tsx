import { Link, Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import LoginPage from './pages/LoginPage';
import JudgePage from './pages/JudgePage';
import CalculatorPage from './pages/CalculatorPage';
import AdminPage from './pages/AdminPage';
import LeaderboardPage from './pages/LeaderboardPage';
import NotFoundPage from './pages/NotFoundPage';
import { ProtectedRoute } from './components/ProtectedRoute';
import type { UserRole } from './api/types';

const defaultRouteByRole: Record<UserRole, string> = {
  judge: '/judge',
  calculator: '/calculator',
  admin: '/admin',
};

function DefaultRoute() {
  const { state } = useAuth();
  if (!state) {
    return <Navigate to="/login" replace />;
  }
  const target = defaultRouteByRole[state.user.role] ?? '/leaderboard';
  return <Navigate to={target} replace />;
}

export default function App() {
  const { state, logout } = useAuth();

  return (
    <div className="app">
      <header className="app__header">
        <div className="app__title">
          <Link to="/leaderboard">Dračí smyčka</Link>
        </div>
        <nav className="app__nav">
          <Link to="/leaderboard">Výsledky</Link>
          {state?.user.role === 'judge' || state?.user.role === 'admin' ? <Link to="/judge">Rozhodčí</Link> : null}
          {state && (state.user.role === 'calculator' || state.user.role === 'admin') ? (
            <Link to="/calculator">Výpočetka</Link>
          ) : null}
          {state?.user.role === 'admin' ? <Link to="/admin">Administrace</Link> : null}
        </nav>
        <div className="app__user">
          {state ? (
            <>
              <span>{state.user.displayName}</span>
              <button type="button" onClick={() => logout()}>
                Odhlásit
              </button>
            </>
          ) : (
            <Link to="/login">Přihlásit</Link>
          )}
        </div>
      </header>
      <main className="app__main">
        <Routes>
          <Route path="/" element={<DefaultRoute />} />
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/judge"
            element={
              <ProtectedRoute allowedRoles={['judge']}>
                <JudgePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/calculator"
            element={
              <ProtectedRoute allowedRoles={['calculator']}>
                <CalculatorPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin"
            element={
              <ProtectedRoute allowedRoles={['admin']}>
                <AdminPage />
              </ProtectedRoute>
            }
          />
          <Route path="/leaderboard" element={<LeaderboardPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </main>
    </div>
  );
}
