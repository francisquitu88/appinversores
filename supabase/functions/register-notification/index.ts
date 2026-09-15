import { withSupabase } from 'npm:@supabase/server'
import { ok, errorResponse, handleOptions } from '../_shared/response.ts'

interface RegisterNotificationRequest {
  ticker: string
  event_type: 'news' | 'sec' | 'rating' | 'insider'
  event_id: string
  title: string
  content?: string | null
  url?: string | null
  source?: string
  published_at?: string | null
}

interface NotificationPreference {
  user_id: string
  email: string
  email_enabled: boolean
  news_enabled: boolean
  sec_enabled: boolean
  ratings_enabled: boolean
  insider_trades_enabled: boolean
}

function generateEventHash(ticker: string, eventType: string, eventId: string): string {
  return `${ticker}:${eventType}:${eventId}`
}

type SupabaseTableQuery = {
  select: (columns: string) => {
    eq: (column: string, value: string | boolean) => {
      eq: (column: string, value: string | boolean) => {
        in?: (column: string, values: string[]) => Promise<{ data: Array<Record<string, unknown>> | null; error: { message: string } | null }>
        maybeSingle?: () => Promise<{ data: Record<string, unknown> | null; error: { message: string } | null }>
        limit?: (count: number) => AsyncReturnType<typeof Promise.resolve<unknown>>
      }
      order?: (...args: unknown[]) => unknown
      limit?: (count: number) => Promise<{ data: Array<Record<string, unknown>> | null; error: { message: string } | null }>
      maybeSingle?: () => Promise<{ data: Record<string, unknown> | null; error: { message: string } | null }>
      upsert?: (record: Record<string, unknown>, options?: Record<string, unknown>) => Promise<{ data: Record<string, unknown> | null; error: { message: string } | null }>
      update?: (record: Record<string, unknown>) => { eq: (column: string, value: string) => Promise<{ error: { message: string } | null }> }
    }
    in?: (column: string, values: string[]) => Promise<{ data: Array<Record<string, unknown>> | null; error: { message: string } | null }>
    maybeSingle?: () => Promise<{ data: Record<string, unknown> | null; error: { message: string } | null }>
    limit?: (count: number) => Promise<{ data: Array<Record<string, unknown>> | null; error: { message: string } | null }>
    upsert?: (record: Record<string, unknown>, options?: Record<string, unknown>) => Promise<{ data: Record<string, unknown> | null; error: { message: string } | null }>
    update?: (record: Record<string, unknown>) => { eq: (column: string, value: string) => Promise<{ error: { message: string } | null }> }
  }
}

type SupabaseClientLike = {
  from: (table: string) => SupabaseTableQuery
}

async function registerNotificationsForEvent(
  req: RegisterNotificationRequest,
  supabase: SupabaseClientLike
): Promise<{ registered: number; skipped: number; errors: string[] }> {
  let registered = 0
  let skipped = 0
  const errors: string[] = []

  try {
    const { data: trackedByUsers, error: trackerError } = await supabase
      .from('tracked_stocks')
      .select('*')
      .eq('ticker', req.ticker)
      .eq('enabled', true)

    if (trackerError) {
      return { registered, skipped, errors: [trackerError.message] }
    }

    if (!trackedByUsers || trackedByUsers.length === 0) {
      return { registered: 0, skipped: 0, errors: [] }
    }

    interface TrackedStockRow {
      user_id: string
      ticker: string
      enabled: boolean
    }

    const userIds = Array.from(new Set((trackedByUsers || []).map((t: TrackedStockRow) => t.user_id)))
    const { data: preferences, error: preferencesError } = await supabase
      .from('notification_preferences')
      .select('*')
      .in('user_id', userIds)

    if (preferencesError) {
      return { registered, skipped, errors: [preferencesError.message] }
    }

    const preferenceMap = new Map<string, NotificationPreference>()
    for (const pref of preferences || []) {
      preferenceMap.set(pref.user_id, pref as NotificationPreference)
    }

    for (const trackedStock of trackedByUsers || []) {
      const userPreferences = preferenceMap.get(trackedStock.user_id)

      if (!userPreferences) {
        skipped++
        continue
      }

      if (!userPreferences.email_enabled) {
        skipped++
        continue
      }

      const eventTypeEnabled =
        (req.event_type === 'news' && userPreferences.news_enabled) ||
        (req.event_type === 'sec' && userPreferences.sec_enabled) ||
        (req.event_type === 'rating' && userPreferences.ratings_enabled) ||
        (req.event_type === 'insider' && userPreferences.insider_trades_enabled)

      if (!eventTypeEnabled) {
        skipped++
        continue
      }

      const eventHash = generateEventHash(req.ticker, req.event_type, req.event_id)
      const subject = `[Market Ledger] New ${
        req.event_type === 'news' ? 'news' :
        req.event_type === 'sec' ? 'SEC filing' :
        req.event_type === 'rating' ? 'analyst rating' :
        'insider trade'
      }: ${req.ticker}`

      const { error: insertError } = await supabase
        .from('notification_sent_log')
        .upsert({
          user_id: trackedStock.user_id,
          ticker: req.ticker,
          event_type: req.event_type,
          event_id: eventHash,
          recipient_email: userPreferences.email,
          subject,
          status: 'pending',
        }, {
          onConflict: 'user_id,ticker,event_type,event_id',
          ignoreDuplicates: true,
        })

      if (insertError) {
        errors.push(`Error registering notification for user ${trackedStock.user_id}: ${insertError.message}`)
        skipped++
      } else {
        const { data: existing } = await supabase
          .from('notification_sent_log')
          .select('id')
          .eq('user_id', trackedStock.user_id)
          .eq('ticker', req.ticker)
          .eq('event_type', req.event_type)
          .eq('event_id', eventHash)
          .limit(1)
          .maybeSingle()

        if (existing) {
          registered++
          console.info(JSON.stringify({
            event: 'notification_registered',
            user_id: trackedStock.user_id,
            ticker: req.ticker,
            event_type: req.event_type,
            event_id: eventHash,
          }))
        } else {
          skipped++
        }
      }
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : 'Unknown error')
  }

  return { registered, skipped, errors }
}

export default {
  fetch: withSupabase(
    { auth: 'secret:notificationservice' },
    async (request: Request, ctx: { supabaseAdmin: SupabaseClientLike }) => {
      const options = handleOptions(request)
      if (options) return options

      if (request.method !== 'POST') {
        return errorResponse('METHOD_NOT_ALLOWED', 'Use POST', 405, request)
      }

      try {
        const payload = await request.json() as RegisterNotificationRequest

        if (!payload.ticker || !payload.event_type || !payload.event_id || !payload.title) {
          return errorResponse('BAD_REQUEST', 'Missing required fields: ticker, event_type, event_id, title', 400, request)
        }

        const result = await registerNotificationsForEvent(payload, ctx.supabaseAdmin)

        return ok({
          message: 'Notifications registered successfully',
          ...result,
        }, request)
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error'
        console.error(JSON.stringify({ event: 'register_notification_error', error: errorMsg }))
        return errorResponse('INTERNAL_ERROR', errorMsg, 500, request)
      }
    },
  ),
}
