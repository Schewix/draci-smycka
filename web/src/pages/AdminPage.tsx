import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import type { AdminCreateCompetitorRequest, AdminEventContextResponse } from '../api/types';

export default function AdminPage() {
  const { state, fetchWithAuth } = useAuth();
  const eventId = state?.event.id;

  const [context, setContext] = useState<AdminEventContextResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [formState, setFormState] = useState<AdminCreateCompetitorRequest>({
    displayName: '',
    categoryCode: '',
    club: undefined,
    startNumber: undefined,
    birthYear: undefined,
    notes: undefined,
    generateToken: true,
  });
  const [createMessage, setCreateMessage] = useState<string | null>(null);

  const [tokenCompetitorId, setTokenCompetitorId] = useState('');
  const [tokenResult, setTokenResult] = useState<string | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(null);

  const loadContext = useCallback(async () => {
    if (!eventId) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await fetchWithAuth<AdminEventContextResponse>(`/admin/events/${eventId}/context`);
      setContext(response);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Načtení kontextu selhalo');
      setContext(null);
    } finally {
      setLoading(false);
    }
  }, [eventId, fetchWithAuth]);

  useEffect(() => {
    loadContext();
  }, [loadContext]);

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault();
    if (!eventId) {
      return;
    }

    try {
      const payload = {
        ...formState,
        startNumber: formState.startNumber ?? undefined,
        birthYear: formState.birthYear ?? undefined,
        notes: formState.notes ?? undefined,
      } satisfies AdminCreateCompetitorRequest;

      const response = await fetchWithAuth<{ competitor: unknown }>(
        `/admin/events/${eventId}/competitors`,
        {
          method: 'POST',
          body: JSON.stringify(payload),
        },
      );

      setCreateMessage('Soutěžící vytvořen');
      setFormState({
        displayName: '',
        categoryCode: '',
        club: undefined,
        startNumber: undefined,
        birthYear: undefined,
        notes: undefined,
        generateToken: true,
      });
      console.log('Created competitor', response);
      await loadContext();
    } catch (err) {
      console.error(err);
      setCreateMessage(err instanceof Error ? err.message : 'Vytvoření selhalo');
    }
  };

  const handleTokenIssue = async (event: FormEvent) => {
    event.preventDefault();
    setTokenResult(null);
    setTokenError(null);

    if (!tokenCompetitorId.trim()) {
      setTokenError('Zadej ID soutěžícího');
      return;
    }
    try {
      const response = await fetchWithAuth<{ token: string }>(
        `/admin/competitors/${tokenCompetitorId.trim()}/token`,
        {
          method: 'POST',
          body: JSON.stringify({ regenerate: true }),
        },
      );
      setTokenResult(`Nový token: ${response.token}`);
      await loadContext();
    } catch (err) {
      console.error(err);
      setTokenError(err instanceof Error ? err.message : 'Generování tokenu selhalo');
    }
  };

  if (!eventId) {
    return <p>Žádný event není vybrán.</p>;
  }

  return (
    <div className="page">
      <div className="card">
        <h1>Administrace</h1>
        <button type="button" onClick={loadContext} disabled={loading}>
          {loading ? 'Aktualizuji…' : 'Obnovit data'}
        </button>
        {error ? <p className="error">{error}</p> : null}
      </div>

      {context ? (
        <div className="card">
          <h2>Event {context.event.name}</h2>
          <p>
            Kategorie: {context.categories.length} · Uzly: {context.nodes.length} · Soutěžících: {context.competitorCount}
          </p>
          <div className="grid">
            <section>
              <h3>Kategorie</h3>
              <ul>
                {context.categories.map((category) => (
                  <li key={category.id}>
                    <strong>{category.code}</strong> – {category.name}
                  </li>
                ))}
              </ul>
            </section>
            <section>
              <h3>Uzly</h3>
              <ul>
                {context.nodes.map((node) => (
                  <li key={node.id}>
                    <strong>{node.name}</strong>
                    {node.is_relay ? ' (štafeta)' : ''}
                    {!node.counts_to_overall ? ' · nepočítá se do overall' : ''}
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </div>
      ) : null}

      <div className="card">
        <h2>Nový soutěžící</h2>
        <form className="form" onSubmit={handleCreate}>
          <label>
            Jméno
            <input
              type="text"
              value={formState.displayName}
              onChange={(event) => setFormState((prev) => ({ ...prev, displayName: event.target.value }))}
              required
            />
          </label>
          <label>
            Kategorie
            <select
              value={formState.categoryCode}
              onChange={(event) => setFormState((prev) => ({ ...prev, categoryCode: event.target.value }))}
              required
            >
              <option value="" disabled>
                Vyber kategorii
              </option>
              {context?.categories.map((category) => (
                <option key={category.id} value={category.code}>
                  {category.code} – {category.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Klub
            <input
              type="text"
              value={formState.club ?? ''}
              onChange={(event) => setFormState((prev) => ({ ...prev, club: event.target.value || undefined }))}
            />
          </label>
          <label>
            Startovní číslo
            <input
              type="number"
              value={formState.startNumber ?? ''}
              onChange={(event) =>
                setFormState((prev) => ({
                  ...prev,
                  startNumber: event.target.value ? Number.parseInt(event.target.value, 10) : undefined,
                }))
              }
            />
          </label>
          <label>
            Rok narození
            <input
              type="number"
              value={formState.birthYear ?? ''}
              onChange={(event) =>
                setFormState((prev) => ({
                  ...prev,
                  birthYear: event.target.value ? Number.parseInt(event.target.value, 10) : undefined,
                }))
              }
            />
          </label>
          <label>
            Poznámka
            <textarea
              value={formState.notes ?? ''}
              onChange={(event) => setFormState((prev) => ({ ...prev, notes: event.target.value || undefined }))}
            />
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={formState.generateToken ?? false}
              onChange={(event) =>
                setFormState((prev) => ({ ...prev, generateToken: event.target.checked }))
              }
            />
            Vygenerovat QR token
          </label>
          <button type="submit">Vytvořit soutěžícího</button>
          {createMessage ? <p className="success">{createMessage}</p> : null}
        </form>
      </div>

      <div className="card">
        <h2>Generovat nový token</h2>
        <form className="form" onSubmit={handleTokenIssue}>
          <label>
            ID soutěžícího
            <input
              type="text"
              value={tokenCompetitorId}
              onChange={(event) => setTokenCompetitorId(event.target.value)}
              required
            />
          </label>
          <button type="submit">Generovat token</button>
        </form>
        {tokenError ? <p className="error">{tokenError}</p> : null}
        {tokenResult ? <p className="success">{tokenResult}</p> : null}
      </div>
    </div>
  );
}
