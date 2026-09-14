import { createClient } from '@supabase/supabase-js'
import type { TrackedStock } from '../types'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined

export class WatchlistError extends Error {
  status?: number
  code?: string

  constructor(message: string, options?: { status?: number; code?: string }) {
    super(message)
    this.name = 'WatchlistError'
    this.status = options?.status
    this.code = options?.code
  }
}

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

  let errorCode: string | undefined
  let errorMessage: string | undefined

  if (payload && typeof payload === 'object') {
    const maybeError = 'error' in payload && payload.error && typeof payload.error === 'object' ? payload.error as Record<string, unknown> : null
    if (maybeError) {
      if (typeof maybeError.code === 'string') errorCode = maybeError.code
      if (typeof maybeError.message === 'string') errorMessage = maybeError.message
    }
  }

  if (!response.ok || !payload || typeof payload !== 'object' || !('success' in payload) || payload.success !== true) {
    const finalMessage = errorMessage ?? `HTTP ${response.status}`
    throw new WatchlistError(finalMessage, {
      status: response.status,
      code: errorCode,
    })
  }
  if (!('data' in payload) || !payload.data || typeof payload.data !== 'object') return null
  return payload.data as TrackedStock
}
