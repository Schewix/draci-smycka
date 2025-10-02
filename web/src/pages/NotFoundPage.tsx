import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  return (
    <div className="page">
      <div className="card">
        <h1>404</h1>
        <p>Stránka nenalezena.</p>
        <Link to="/">Zpět na hlavní stránku</Link>
      </div>
    </div>
  );
}
