import { Router } from 'express';
import { z } from 'zod';
import { supabase } from '../supabase.js';
import { HttpError } from '../utils/errors.js';
import { handleSupabaseMaybe } from '../utils/supabase.js';
import type { EventRow } from '../types.js';

const router = Router();

router.get('/events/:slug', async (req, res, next) => {
  try {
    const slug = z.string().min(1).parse(req.params.slug);

    const event = handleSupabaseMaybe<EventRow>(
      await supabase
        .from('events')
        .select('id, name, slug, base_path')
        .eq('slug', slug)
        .maybeSingle(),
      'Event not found',
    );

    if (!event) {
      throw new HttpError(404, 'Event not found');
    }

    const competitorsResponse = await supabase
      .from('competitors')
      .select('id, display_name, category_code, club, start_number')
      .eq('event_id', event.id);

    if (competitorsResponse.error) {
      throw new HttpError(500, 'Failed to load competitors', competitorsResponse.error);
    }

    const competitorMap = new Map(
      (competitorsResponse.data ?? []).map((competitor) => [competitor.id, competitor]),
    );

    const categoryLeaderboardResponse = await supabase
      .from('category_leaderboards')
      .select(
        'event_id, category_code, competitor_id, placement_sum, tie_break_centiseconds_sum, counted_nodes, has_non_time, competitor_count, overall_rank',
      )
      .eq('event_id', event.id)
      .order('category_code', { ascending: true })
      .order('overall_rank', { ascending: true });

    if (categoryLeaderboardResponse.error) {
      throw new HttpError(500, 'Failed to load category leaderboards', categoryLeaderboardResponse.error);
    }

    const nodeRankingsResponse = await supabase
      .from('category_node_rankings')
      .select(
        'event_id, category_code, node_id, sequence, competitor_id, best_centiseconds, has_fault, has_any_attempt, status, time_rank, competitor_count, placement, tie_break_centiseconds',
      )
      .eq('event_id', event.id)
      .order('category_code', { ascending: true })
      .order('sequence', { ascending: true })
      .order('placement', { ascending: true });

    if (nodeRankingsResponse.error) {
      throw new HttpError(500, 'Failed to load node rankings', nodeRankingsResponse.error);
    }

    const relayLeaderboardResponse = await supabase
      .from('relay_leaderboards')
      .select(
        'event_id, category_code, competitor_id, placement_sum, tie_break_centiseconds_sum, counted_nodes, competitor_count, relay_rank',
      )
      .eq('event_id', event.id)
      .order('category_code', { ascending: true })
      .order('relay_rank', { ascending: true });

    if (relayLeaderboardResponse.error) {
      throw new HttpError(500, 'Failed to load relay leaderboards', relayLeaderboardResponse.error);
    }

    const categoryNodeRankingsByCompetitor = new Map<string, unknown[]>();
    for (const entry of nodeRankingsResponse.data ?? []) {
      const key = `${entry.category_code}:${entry.competitor_id}`;
      const existing = categoryNodeRankingsByCompetitor.get(key) ?? [];
      existing.push(entry);
      categoryNodeRankingsByCompetitor.set(key, existing);
    }

    const categoryLeaderboards = (categoryLeaderboardResponse.data ?? []).map((row) => {
      const competitor = competitorMap.get(row.competitor_id);
      return {
        ...row,
        competitor: competitor
          ? {
              id: competitor.id,
              displayName: competitor.display_name,
              club: competitor.club,
              startNumber: competitor.start_number,
            }
          : null,
        nodes: categoryNodeRankingsByCompetitor.get(`${row.category_code}:${row.competitor_id}`) ?? [],
      };
    });

    const relayLeaderboards = (relayLeaderboardResponse.data ?? []).map((row) => {
      const competitor = competitorMap.get(row.competitor_id);
      return {
        ...row,
        competitor: competitor
          ? {
              id: competitor.id,
              displayName: competitor.display_name,
              club: competitor.club,
              startNumber: competitor.start_number,
            }
          : null,
      };
    });

    res.json({
      event,
      categoryLeaderboards,
      relayLeaderboards,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
