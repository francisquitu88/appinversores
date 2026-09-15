import { withSupabase } from 'npm:@supabase/server'
import { ok, errorResponse, handleOptions } from '../_shared/response.ts'

interface EmailPayload {
  to: string
  subject: string
  html: string
}

interface NotificationRecord {
  id: string
  user_id: string
  ticker: string
  event_type: 'news' | 'sec' | 'rating' | 'insider'
  event_id: string
  recipient_email: string
  subject: string
  status: string
  attempts: number
}

function getConfiguredSender(): string {
  const fromEmail = Deno.env.get('RESEND_FROM_EMAIL')
  if (!fromEmail || !fromEmail.includes('@')) {
    throw new Error('RESEND_FROM_EMAIL is not configured with a verified sender address')
  }
  return fromEmail
}

function getConfiguredNotificationRecipient(defaultEmail: string): string {
  const configuredRecipient = Deno.env.get('NOTIFICATION_RECIPIENT_EMAIL')
  if (configuredRecipient && configuredRecipient.includes('@')) {
    return configuredRecipient
  }
  return defaultEmail
}

function getAppBaseUrl(): string {
  return Deno.env.get('APP_BASE_URL') ?? Deno.env.get('SITE_URL') ?? 'http://localhost:3000'
}

function generateEmailHTML(
  ticker: string,
  eventType: 'news' | 'sec' | 'rating' | 'insider',
  title: string,
  content: string | null,
  url: string | null,
  source: string | null,
  publishedAt: string | null
): string {
  const displayUrl = url || '#'
  const displaySource = source || 'Market Ledger'
  const displayDate = publishedAt ? new Date(publishedAt).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/New_York'
  }) : ''

  const eventTypeLabel = eventType === 'news'
    ? 'News'
    : eventType === 'sec'
      ? 'SEC Filing'
      : eventType === 'rating'
        ? 'Analyst Rating'
        : 'Insider Trade'

  return `
<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif;
        line-height: 1.6;
        color: #333;
        margin: 0;
        padding: 0;
        background-color: #f5f5f5;
      }
      .container {
        max-width: 600px;
        margin: 0 auto;
        background-color: #ffffff;
        border-radius: 8px;
        overflow: hidden;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
      }
      .header {
        background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%);
        color: white;
        padding: 20px;
        text-align: center;
      }
      .header h1 {
        margin: 0;
        font-size: 24px;
        font-weight: 600;
      }
      .content {
        padding: 30px;
      }
      .ticker {
        display: inline-block;
        background-color: #f0f0f0;
        color: #1a1a1a;
        padding: 4px 8px;
        border-radius: 4px;
        font-weight: 600;
        font-size: 14px;
        margin-right: 10px;
      }
      .event-type {
        display: inline-block;
        background-color: #e8f4f8;
        color: #0066cc;
        padding: 4px 8px;
        border-radius: 4px;
        font-size: 12px;
        font-weight: 600;
        text-transform: uppercase;
      }
      .metadata {
        margin-bottom: 20px;
        padding-bottom: 15px;
        border-bottom: 1px solid #e0e0e0;
      }
      .title {
        font-size: 20px;
        font-weight: 700;
        color: #1a1a1a;
        margin: 20px 0 10px 0;
      }
      .summary {
        color: #555;
        margin: 15px 0;
      }
      .details {
        background-color: #f9f9f9;
        border-left: 4px solid #0066cc;
        padding: 12px;
        margin: 15px 0;
        border-radius: 4px;
      }
      .detail-item {
        margin: 8px 0;
        font-size: 13px;
        color: #666;
      }
      .detail-label {
        font-weight: 600;
        color: #333;
      }
      .cta-button {
        display: inline-block;
        background-color: #0066cc;
        color: white !important;
        padding: 12px 24px;
        border-radius: 6px;
        text-decoration: none;
        font-weight: 600;
        margin: 20px 0;
        text-align: center;
      }
      .cta-button:hover {
        background-color: #0052a3;
      }
      .footer {
        background-color: #f5f5f5;
        padding: 20px;
        text-align: center;
        font-size: 12px;
        color: #999;
        border-top: 1px solid #e0e0e0;
      }
      .footer a {
        color: #0066cc;
        text-decoration: none;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header">
        <h1>Market Ledger</h1>
      </div>
      <div class="content">
        <div class="metadata">
          <span class="ticker">${ticker}</span>
          <span class="event-type">${eventTypeLabel}</span>
        </div>

        <h2 class="title">${title}</h2>

        ${content ? `<div class="summary">${content}</div>` : ''}

        <div class="details">
          ${displaySource ? `<div class="detail-item"><span class="detail-label">Source:</span> ${displaySource}</div>` : ''}
          ${displayDate ? `<div class="detail-item"><span class="detail-label">Date:</span> ${displayDate}</div>` : ''}
        </div>

        <a href="${displayUrl}" class="cta-button">View on Market Ledger</a>
      </div>
      <div class="footer">
        <p>You received this email because you follow <strong>${ticker}</strong> on Market Ledger.</p>
        <p><a href="https://market-ledger.app/settings">Manage your notification preferences</a></p>
        <p>&copy; 2026 Market Ledger. All rights reserved.</p>
      </div>
    </div>
  </body>
</html>
  `.trim()
}

async function sendViaResend(payload: EmailPayload): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const apiKey = Deno.env.get('RESEND_API_KEY')
  if (!apiKey) {
    return { success: false, error: 'RESEND_API_KEY not configured' }
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: getConfiguredSender(),
        to: payload.to,
        subject: payload.subject,
        html: payload.html,
      }),
    })

    if (!response.ok) {
      const errorData = await response.json()
      return { success: false, error: `Resend API error: ${response.status} ${JSON.stringify(errorData)}` }
    }

    const data = await response.json()
    return { success: true, messageId: data.id }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error sending email' }
  }
}

type SupabaseClientLike = {
  from: (table: string) => {
    update: (values: Record<string, unknown>) => {
      eq: (column: string, value: string) => Promise<{ error: { message: string } | null }>
    }
    select: (columns?: string) => {
      eq: (column: string, value: string) => {
        order?: (column: string, options?: Record<string, unknown>) => {
          limit: (count: number) => Promise<{ data: Array<Record<string, unknown>> | null; error: { message: string } | null }>
        }
      }
    }
  }
}

async function updateNotificationStatus(
  supabase: SupabaseClientLike,
  notificationId: string,
  status: 'pending' | 'sending' | 'sent' | 'failed',
  sentAt: string | null,
  errorMessage: string | null,
  attempts: number
): Promise<void> {
  const { error } = await supabase
    .from('notification_sent_log')
    .update({
      status,
      sent_at: sentAt,
      error_message: errorMessage,
      attempts,
    })
    .eq('id', notificationId)

  if (error) {
    console.error(JSON.stringify({
      event: 'update_notification_status_error',
      notification_id: notificationId,
      error: error.message,
    }))
  }
}

async function processPendingNotifications(supabase: SupabaseClientLike): Promise<{ processed: number; sent: number; failed: number }> {
  let processed = 0
  let sent = 0
  let failed = 0

  const { data: notifications, error: fetchError } = await supabase
    .from('notification_sent_log')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(10)

  if (fetchError) {
    console.error(JSON.stringify({ event: 'fetch_pending_notifications_error', error: fetchError.message }))
    return { processed, sent, failed }
  }

  for (const notification of notifications || []) {
    const record = notification as NotificationRecord
    processed++

    try {
      const nextAttempts = (typeof record.attempts === 'number' ? record.attempts : 0) + 1

      await updateNotificationStatus(supabase, record.id, 'sending', null, null, nextAttempts)

      const htmlContent = generateEmailHTML(
        record.ticker,
        record.event_type,
        record.subject,
        null,
        `${getAppBaseUrl()}/company/${record.ticker}`,
        record.event_type === 'news' ? 'Finviz' : record.event_type === 'sec' ? 'SEC EDGAR' : 'Market Ledger',
        new Date().toISOString()
      )

      const effectiveRecipient = getConfiguredNotificationRecipient(record.recipient_email)
      const sendResult = await sendViaResend({
        to: effectiveRecipient,
        subject: record.subject,
        html: htmlContent,
      })

      if (sendResult.success) {
        await updateNotificationStatus(supabase, record.id, 'sent', new Date().toISOString(), null, nextAttempts)
        sent++
        console.info(JSON.stringify({
          event: 'notification_sent',
          notification_id: record.id,
          ticker: record.ticker,
          event_type: record.event_type,
          recipient: record.recipient_email,
        }))
      } else {
        await updateNotificationStatus(supabase, record.id, 'failed', null, sendResult.error || 'Unknown error', nextAttempts)
        failed++
        console.error(JSON.stringify({
          event: 'notification_send_failed',
          notification_id: record.id,
          ticker: record.ticker,
          error: sendResult.error,
        }))
      }
    } catch (error) {
      failed++
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      await updateNotificationStatus(supabase, record.id, 'failed', null, errorMsg, typeof record.attempts === 'number' ? record.attempts + 1 : 1)
      console.error(JSON.stringify({
        event: 'notification_processing_error',
        notification_id: record.id,
        error: errorMsg,
      }))
    }
  }

  return { processed, sent, failed }
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
        const result = await processPendingNotifications(ctx.supabaseAdmin)
        return ok({
          message: 'Notification processing completed',
          ...result,
        }, request)
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error'
        console.error(JSON.stringify({ event: 'send_notification_email_error', error: errorMsg }))
        return errorResponse('INTERNAL_ERROR', errorMsg, 500, request)
      }
    },
  ),
}
