import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import type { AttemptDto, JudgeLookupResponse, NodeDto } from '../api/types';
import { formatCentiseconds, parseTimeInput } from '../utils/time';

interface LookupState {
  loading: boolean;
  error: string | null;
}

interface SaveState {
  saving: boolean;
  error: string | null;
  success: string | null;
}

export default function JudgePage() {
  const { state, fetchWithAuth } = useAuth();
  const [token, setToken] = useState('');
  const [lookupState, setLookupState] = useState<LookupState>({ loading: false, error: null });
  const [saveState, setSaveState] = useState<SaveState>({ saving: false, error: null, success: null });
  const [payload, setPayload] = useState<JudgeLookupResponse | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [timeInput, setTimeInput] = useState('');

  const assignedNodes: NodeDto[] = useMemo(() => {
    if (!state) {
      return [];
    }
    const nodeSet = new Set(state.assignments.nodeIds);
    return state.nodes.filter((node) => nodeSet.has(node.id));
  }, [state]);

  useEffect(() => {
    if (!selectedNodeId && assignedNodes.length > 0) {
      setSelectedNodeId(assignedNodes[0]?.id ?? null);
    }
  }, [assignedNodes, selectedNodeId]);

  const selectedNode = assignedNodes.find((node) => node.id === selectedNodeId) ?? null;

  const nodeAttempts: AttemptDto[] = useMemo(() => {
    if (!payload || !selectedNodeId) {
      return [];
    }
    return payload.attempts.filter((attempt) => attempt.node_id === selectedNodeId);
  }, [payload, selectedNodeId]);

  const attempt1 = nodeAttempts.find((attempt) => attempt.attempt_number === 1) ?? null;
  const attempt2 = nodeAttempts.find((attempt) => attempt.attempt_number === 2) ?? null;

  const nextAttemptNumber = useMemo(() => {
    if (!attempt1) {
      return 1;
    }
    if (!attempt2) {
      return 2;
    }
    return null;
  }, [attempt1, attempt2]);

  const resetStates = () => {
    setSaveState({ saving: false, error: null, success: null });
  };

  const handleLookup = useCallback(
    async (targetToken: string) => {
      if (!targetToken || !state) {
        return;
      }
      resetStates();
      setLookupState({ loading: true, error: null });
      try {
        const response = await fetchWithAuth<JudgeLookupResponse>(
          `/judge/competitors/lookup?token=${encodeURIComponent(targetToken)}`,
        );
        setPayload(response);
        setLookupState({ loading: false, error: null });
      } catch (error) {
        console.error(error);
        setPayload(null);
        setLookupState({ loading: false, error: error instanceof Error ? error.message : 'Nenačteno' });
      }
    },
    [fetchWithAuth, state],
  );

  const refresh = useCallback(async () => {
    if (payload) {
      await handleLookup(token);
    }
  }, [handleLookup, payload, token]);

  const onLookupSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (token.trim() === '') {
      setLookupState({ loading: false, error: 'Zadej token' });
      return;
    }
    await handleLookup(token.trim());
  };

  const submitAttempt = useCallback(
    async (
      submission:
        | { kind: 'time'; centiseconds: number }
        | { kind: 'fault'; faultCode: string },
    ) => {
      if (!payload || !selectedNodeId || !nextAttemptNumber) {
        return;
      }
      setSaveState({ saving: true, error: null, success: null });
      try {
        const body = {
          competitorId: payload.competitor.id,
          nodeId: selectedNodeId,
          attemptNumber: nextAttemptNumber,
          result: submission,
        };

        await fetchWithAuth('/judge/attempts', {
          method: 'POST',
          body: JSON.stringify(body),
        });

        setSaveState({ saving: false, error: null, success: 'Uloženo' });
        setTimeInput('');
        await refresh();
      } catch (error) {
        console.error(error);
        setSaveState({
          saving: false,
          error: error instanceof Error ? error.message : 'Uložení selhalo',
          success: null,
        });
      }
    },
    [fetchWithAuth, nextAttemptNumber, payload, refresh, selectedNodeId],
  );

  const handleTimeSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!nextAttemptNumber) {
      setSaveState({ saving: false, error: 'Oba pokusy již existují', success: null });
      return;
    }
    const parsed = parseTimeInput(timeInput);
    if (parsed == null) {
      setSaveState({ saving: false, error: 'Neplatný formát času (mm:ss.cc)', success: null });
      return;
    }
    submitAttempt({ kind: 'time', centiseconds: parsed });
  };

  const handleFault = async () => {
    if (!nextAttemptNumber) {
      setSaveState({ saving: false, error: 'Oba pokusy již existují', success: null });
      return;
    }
    await submitAttempt({ kind: 'fault', faultCode: '333' });
  };

  return (
    <div className="page">
      <div className="card">
        <h1>Rozhodčí</h1>
        <form className="form" onSubmit={onLookupSubmit}>
          <label>
            Token soutěžícího
            <input
              type="text"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="Zadej nebo naskenuj QR"
              required
            />
          </label>
          <button type="submit" disabled={lookupState.loading}>
            {lookupState.loading ? 'Načítám…' : 'Načíst soutěžícího'}
          </button>
        </form>
        {lookupState.error ? <p className="error">{lookupState.error}</p> : null}
      </div>

      {payload && selectedNode ? (
        <div className="card">
          <header className="card__header">
            <div>
              <h2>{payload.competitor.displayName}</h2>
              <p>
                Kategorie {payload.competitor.categoryCode}
                {payload.competitor.startNumber != null ? ` · start #${payload.competitor.startNumber}` : ''}
              </p>
            </div>
            <div>
              <label>
                Uzel
                <select
                  value={selectedNodeId ?? ''}
                  onChange={(event) => setSelectedNodeId(event.target.value)}
                >
                  {assignedNodes.map((node) => (
                    <option key={node.id} value={node.id}>
                      {node.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </header>

          <section className="attempts">
            <table>
              <thead>
                <tr>
                  <th>Pokus</th>
                  <th>Výsledek</th>
                  <th>Zadal</th>
                </tr>
              </thead>
              <tbody>
                {[1, 2].map((number) => {
                  const attempt = number === 1 ? attempt1 : attempt2;
                  return (
                    <tr key={number}>
                      <td>{number}</td>
                      <td>
                        {attempt
                          ? attempt.result_kind === 'time'
                            ? formatCentiseconds(attempt.centiseconds)
                            : attempt.fault_code ?? '333'
                          : '—'}
                      </td>
                      <td>{attempt?.recorded_role ?? '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>

          <section className="form">
            <h3>Nový pokus</h3>
            {nextAttemptNumber ? (
              <>
                <form onSubmit={handleTimeSubmit} className="inline-form">
                  <label>
                    Čas (mm:ss.cc)
                    <input
                      type="text"
                      value={timeInput}
                      onChange={(event) => setTimeInput(event.target.value)}
                      placeholder="00:15.32"
                    />
                  </label>
                  <button type="submit" disabled={saveState.saving}>
                    Uložit čas
                  </button>
                </form>
                <button type="button" className="secondary" onClick={handleFault} disabled={saveState.saving}>
                  Zapsat 333
                </button>
              </>
            ) : (
              <p>Oba pokusy jsou již zaznamenané.</p>
            )}
            {saveState.error ? <p className="error">{saveState.error}</p> : null}
            {saveState.success ? <p className="success">{saveState.success}</p> : null}
          </section>
        </div>
      ) : null}
    </div>
  );
}
