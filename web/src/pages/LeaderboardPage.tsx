import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../api/client';
import type { LeaderboardEntry, LeaderboardResponse, RelayLeaderboardEntry } from '../api/types';
import { formatCentiseconds } from '../utils/time';
import { useAuth } from '../context/AuthContext';

function groupByCategory(entries: LeaderboardEntry[]) {
  const map = new Map<string, LeaderboardEntry[]>();
  for (const entry of entries) {
    const key = entry.category_code;
    const arr = map.get(key) ?? [];
    arr.push(entry);
    map.set(key, arr);
  }
  return map;
}

function groupRelay(entries: RelayLeaderboardEntry[]) {
  const map = new Map<string, RelayLeaderboardEntry[]>();
  for (const entry of entries) {
    const key = entry.category_code;
    const arr = map.get(key) ?? [];
    arr.push(entry);
    map.set(key, arr);
  }
  return map;
}

export default function LeaderboardPage() {
  const { state } = useAuth();
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const slug = state?.event.slug ?? 'draci-smycka';

  useEffect(() => {
    let isMounted = true;
    setLoading(true);
    setError(null);
    apiFetch<LeaderboardResponse>(`/leaderboard/events/${slug}`)
      .then((response) => {
        if (!isMounted) return;
        setData(response);
      })
      .catch((err) => {
        if (!isMounted) return;
        console.error(err);
        setError(err instanceof Error ? err.message : 'Načtení výsledků selhalo');
        setData(null);
      })
      .finally(() => {
        if (!isMounted) return;
        setLoading(false);
      });
    return () => {
      isMounted = false;
    };
  }, [slug]);

  const categories = useMemo(() => groupByCategory(data?.categoryLeaderboards ?? []), [data]);
  const relay = useMemo(() => groupRelay(data?.relayLeaderboards ?? []), [data]);

  return (
    <div className="page">
      <div className="card card--hero">
        <h1>Výsledky</h1>
        <p>{data ? data.event.name : 'Načítám…'}</p>
        {loading ? <p>Načítám…</p> : null}
        {error ? <p className="error">{error}</p> : null}
      </div>

      {Array.from(categories.entries()).map(([category, entries]) => (
        <div key={category} className="card">
          <h2>Kategorie {category}</h2>
          <table>
            <thead>
              <tr>
                <th>Pořadí</th>
                <th>Soutěžící</th>
                <th>Součet pořadí</th>
                <th>Tie-break</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.competitor_id}>
                  <td>{entry.overall_rank}</td>
                  <td>{entry.competitor?.displayName ?? entry.competitor_id}</td>
                  <td>{entry.placement_sum}</td>
                  <td>{formatCentiseconds(entry.tie_break_centiseconds_sum)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {relay.size > 0 ? (
        <div className="card">
          <h2>Štafeta</h2>
          {Array.from(relay.entries()).map(([category, entries]) => (
            <section key={category}>
              <h3>{category}</h3>
              <table>
                <thead>
                  <tr>
                    <th>Pořadí</th>
                    <th>Soutěžící</th>
                    <th>Součet pořadí</th>
                    <th>Tie-break</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr key={`${category}-${entry.competitor_id}`}>
                      <td>{entry.relay_rank}</td>
                      <td>{entry.competitor?.displayName ?? entry.competitor_id}</td>
                      <td>{entry.placement_sum}</td>
                      <td>{formatCentiseconds(entry.tie_break_centiseconds_sum)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </div>
      ) : null}
    </div>
  );
}
