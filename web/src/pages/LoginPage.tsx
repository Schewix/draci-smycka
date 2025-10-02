import { FormEvent, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import type { UserRole } from '../api/types';

const roleDefaultRoute: Record<UserRole, string> = {
  judge: '/judge',
  calculator: '/calculator',
  admin: '/admin',
};

export default function LoginPage() {
  const { login, state } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: Location })?.from?.pathname;

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [eventSlug, setEventSlug] = useState('');
  const [deviceName, setDeviceName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (state) {
      const target = from || roleDefaultRoute[state.user.role] || '/leaderboard';
      navigate(target, { replace: true });
    }
  }, [state, from, navigate]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email, password, eventSlug || undefined, deviceName || undefined);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Přihlášení selhalo');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page">
      <div className="card">
        <h1>Přihlášení</h1>
        <form onSubmit={handleSubmit} className="form">
          <label>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </label>
          <label>
            Heslo
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </label>
          <label>
            Event slug (volitelné)
            <input
              type="text"
              placeholder="draci-smycka"
              value={eventSlug}
              onChange={(e) => setEventSlug(e.target.value)}
            />
          </label>
          <label>
            Zařízení (volitelné)
            <input
              type="text"
              placeholder="Tablet rozhodčího"
              value={deviceName}
              onChange={(e) => setDeviceName(e.target.value)}
            />
          </label>
          {error ? <p className="error">{error}</p> : null}
          <button type="submit" disabled={loading}>
            {loading ? 'Přihlašuji…' : 'Přihlásit'}
          </button>
        </form>
      </div>
    </div>
  );
}
