import { createClient } from '@supabase/supabase-js'
import type { TrackedStock } from '../types'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined

export const supabase = supabaseUrl && publishableKey ? createClient(supabaseUrl, publishableKey) : null

export async function updateWatchlist(action: 'enable' | 'disable', ticker: string, accessToken: string): Promise<TrackedStock | null> {
  if (!supabaseUrl || !publishableKey) throw new Error('Supabase configuration is missing')
  const response = await fetch(`${supabaseUrl}/functions/v1/manage-watchlist`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: publishableKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action, ticker }),
  })
  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok || !payload || typeof payload !== 'object' || !('success' in payload) || payload.success !== true) {
    throw new Error('Unable to update watchlist')
  }
  if (!('data' in payload) || !payload.data || typeof payload.data !== 'object') return null
  return payload.data as TrackedStock
}
