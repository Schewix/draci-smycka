import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import type {
  AttemptDto,
  CalculatorCompetitorResponse,
  CalculatorUpdateAttemptResponse,
} from '../api/types';
import { formatCentiseconds, parseTimeInput } from '../utils/time';

interface LookupResult {
  competitor: {
    id: string;
    displayName: string;
  };
}

export default function CalculatorPage() {
  const { fetchWithAuth } = useAuth();
  const [identifier, setIdentifier] = useState('');
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<CalculatorCompetitorResponse | null>(null);
  const [editing, setEditing] = useState<AttemptDto | null>(null);
  const [timeValue, setTimeValue] = useState('');
  const [isFault, setIsFault] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const attemptsList = useMemo(() => {
    if (!data) {
      return [] as { nodeId: string; attempts: AttemptDto[] }[];
    }
    return Object.entries(data.attemptsByNode).map(([nodeId, attempts]) => ({
      nodeId,
      attempts,
    }));
  }, [data]);

  const startEditing = (attempt: AttemptDto) => {
    setEditing(attempt);
    if (attempt.result_kind === 'time' && attempt.centiseconds != null) {
      const formatted = formatCentiseconds(attempt.centiseconds);
      setTimeValue(formatted);
      setIsFault(false);
    } else {
      setTimeValue('');
      setIsFault(true);
    }
    setSaveError(null);
    setSuccessMessage(null);
  };

  const resetEditing = () => {
    setEditing(null);
    setTimeValue('');
    setIsFault(false);
    setSaveError(null);
  };

  const fetchCompetitor = useCallback(
    async (competitorId: string) => {
      setLoading(true);
      setLookupError(null);
      setSuccessMessage(null);
      try {
        const response = await fetchWithAuth<CalculatorCompetitorResponse>(
          `/calculator/competitors/${competitorId}`,
        );
        setData(response);
      } catch (error) {
        console.error(error);
        setData(null);
        setLookupError(error instanceof Error ? error.message : 'Nepodařilo se načíst soutěžícího');
      } finally {
        setLoading(false);
      }
    },
    [fetchWithAuth],
  );

  const handleLookup = async (event: FormEvent) => {
    event.preventDefault();
    if (!identifier.trim()) {
      setLookupError('Zadej token nebo ID soutěžícího');
      return;
    }

    const input = identifier.trim();
    const isUuid = /^[0-9a-fA-F-]{36}$/.test(input);

    if (isUuid) {
      await fetchCompetitor(input);
      return;
    }

    // Treat input as QR token
    try {
      setLoading(true);
      const lookup = await fetchWithAuth<LookupResult>(
        `/calculator/competitors/lookup?token=${encodeURIComponent(input)}`,
      );
      await fetchCompetitor(lookup.competitor.id);
    } catch (error) {
      console.error(error);
      setLookupError(error instanceof Error ? error.message : 'Soupeře se nepodařilo najít');
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (event: FormEvent) => {
    event.preventDefault();
    if (!editing) {
      return;
    }

    let payload;
    if (isFault) {
      payload = { result: { kind: 'fault' as const, faultCode: '333' } };
    } else {
      const parsed = parseTimeInput(timeValue);
      if (parsed == null) {
        setSaveError('Zadej čas ve formátu mm:ss.cc');
        return;
      }
      payload = { result: { kind: 'time' as const, centiseconds: parsed } };
    }

    setSaveError(null);

    try {
      await fetchWithAuth<CalculatorUpdateAttemptResponse>(`/calculator/attempts/${editing.id}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      setSuccessMessage('Uloženo');
      await fetchCompetitor(editing.competitor_id);
      resetEditing();
    } catch (error) {
      console.error(error);
      setSaveError(error instanceof Error ? error.message : 'Uložení změny selhalo');
    }
  };

  useEffect(() => {
    if (!editing) {
      return;
    }
    if (data?.competitor.id !== editing.competitor_id) {
      resetEditing();
    }
  }, [data, editing]);

  return (
    <div className="page">
      <div className="card">
        <h1>Výpočetka</h1>
        <form className="form" onSubmit={handleLookup}>
          <label>
            Token nebo ID soutěžícího
            <input
              type="text"
              value={identifier}
              onChange={(event) => setIdentifier(event.target.value)}
              placeholder="QR token nebo UUID"
              required
            />
          </label>
          <button type="submit" disabled={loading}>
            {loading ? 'Načítám…' : 'Vyhledat'}
          </button>
        </form>
        {lookupError ? <p className="error">{lookupError}</p> : null}
      </div>

      {data ? (
        <div className="card">
          <header className="card__header">
            <div>
              <h2>{data.competitor.displayName}</h2>
              <p>
                Kategorie {data.competitor.categoryCode}
                {data.competitor.startNumber != null ? ` · start #${data.competitor.startNumber}` : ''}
              </p>
            </div>
          </header>

          <section className="attempts">
            <table>
              <thead>
                <tr>
                  <th>Uzel</th>
                  <th>Pokus</th>
                  <th>Výsledek</th>
                  <th>Akce</th>
                </tr>
              </thead>
              <tbody>
                {attemptsList.length === 0 ? (
                  <tr>
                    <td colSpan={4}>Žádné pokusy</td>
                  </tr>
                ) : null}
                {attemptsList.map(({ nodeId, attempts }) => {
                  const node = data.nodes.find((entry) => entry.id === nodeId);
                  return [1, 2].map((order) => {
                    const attempt = attempts.find((item) => item.attempt_number === order) ?? null;
                    return (
                      <tr key={`${nodeId}-${order}`}>
                        <td>{node?.name ?? nodeId}</td>
                        <td>{order}</td>
                        <td>
                          {attempt
                            ? attempt.result_kind === 'time'
                              ? formatCentiseconds(attempt.centiseconds)
                              : attempt.fault_code ?? '333'
                            : '—'}
                        </td>
                        <td>
                          {attempt ? (
                            <button type="button" onClick={() => startEditing(attempt)}>
                              Upravit
                            </button>
                          ) : (
                            '—'
                          )}
                        </td>
                      </tr>
                    );
                  });
                })}
              </tbody>
            </table>
          </section>

          {editing ? (
            <section className="form">
              <h3>
                Úprava pokusu {editing.attempt_number} ({formatCentiseconds(editing.centiseconds)})
              </h3>
              <form onSubmit={handleSave} className="inline-form">
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={isFault}
                    onChange={(event) => setIsFault(event.target.checked)}
                  />
                  Zapsat 333
                </label>
                {!isFault ? (
                  <label>
                    Čas (mm:ss.cc)
                    <input
                      type="text"
                      value={timeValue}
                      onChange={(event) => setTimeValue(event.target.value)}
                      placeholder="00:12.45"
                      required
                    />
                  </label>
                ) : null}
                <div className="actions">
                  <button type="submit">Uložit změnu</button>
                  <button type="button" className="secondary" onClick={resetEditing}>
                    Zrušit
                  </button>
                </div>
              </form>
              {saveError ? <p className="error">{saveError}</p> : null}
              {successMessage ? <p className="success">{successMessage}</p> : null}
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
