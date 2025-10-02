import { Link, Navigate, NavLink, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import LoginPage from './pages/LoginPage';
import JudgePage from './pages/JudgePage';
import CalculatorPage from './pages/CalculatorPage';
import AdminPage from './pages/AdminPage';
import LeaderboardPage from './pages/LeaderboardPage';
import NotFoundPage from './pages/NotFoundPage';
import { ProtectedRoute } from './components/ProtectedRoute';
import type { UserRole } from './api/types';
import logo from './assets/znak_SPTO_transparent.png';

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
        <div className="app__header-inner">
          <div className="app__brand">
            <img className="app__logo" src={logo} alt="Logo SPTO" />
            <div className="app__brand-text">
              <Link className="app__title" to="/leaderboard">
                Dračí smyčka
              </Link>
              <span className="app__subtitle">Scoreboard SPTO</span>
            </div>
          </div>
          <nav className="app__nav">
            <NavLink className={({ isActive }) => (isActive ? 'app__nav-link app__nav-link--active' : 'app__nav-link')} to="/leaderboard">
              Výsledky
            </NavLink>
            {state?.user.role === 'judge' || state?.user.role === 'admin' ? (
              <NavLink
                className={({ isActive }) => (isActive ? 'app__nav-link app__nav-link--active' : 'app__nav-link')}
                to="/judge"
              >
                Rozhodčí
              </NavLink>
            ) : null}
            {state && (state.user.role === 'calculator' || state.user.role === 'admin') ? (
              <NavLink
                className={({ isActive }) => (isActive ? 'app__nav-link app__nav-link--active' : 'app__nav-link')}
                to="/calculator"
              >
                Výpočetka
              </NavLink>
            ) : null}
            {state?.user.role === 'admin' ? (
              <NavLink
                className={({ isActive }) => (isActive ? 'app__nav-link app__nav-link--active' : 'app__nav-link')}
                to="/admin"
              >
                Administrace
              </NavLink>
            ) : null}
          </nav>
          <div className="app__user">
            {state ? (
              <>
                <span className="app__user-name">{state.user.displayName}</span>
                <button className="app__user-action" type="button" onClick={() => logout()}>
                  Odhlásit
                </button>
              </>
            ) : (
              <Link className="app__user-login" to="/login">
                Přihlásit
              </Link>
            )}
          </div>
        </div>
      </header>
      <main className="app__main">
        <div className="app__main-inner">
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
        </div>
      </main>
    </div>
  );
}
