import type { PostgrestError, PostgrestSingleResponse } from '@supabase/supabase-js';
import { HttpError } from './errors.js';

export function handleSupabaseError<T>(response: { data: T | null; error: PostgrestError | null }, message: string): T {
  if (response.error) {
    throw new HttpError(500, message, response.error);
  }
  if (!response.data) {
    throw new HttpError(404, message);
  }
  return response.data;
}

export function handleSupabaseMaybe<T>(
  response: PostgrestSingleResponse<T | null>,
  notFoundMessage: string,
): T | null {
  if (response.error) {
    throw new HttpError(500, notFoundMessage, response.error);
  }
  return response.data;
}

export function ensureRows<T>(response: { data: T[] | null; error: PostgrestError | null }, message: string): T[] {
  if (response.error) {
    throw new HttpError(500, message, response.error);
  }
  return response.data ?? [];
}
