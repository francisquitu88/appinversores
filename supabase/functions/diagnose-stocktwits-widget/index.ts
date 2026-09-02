import { createFirecrawlClient } from '../_shared/firecrawl.ts'
import { handleOptions, jsonResponse, readJson } from '../_shared/response.ts'
import { normalizeTicker } from '../_shared/scraper.ts'
import { requireAuthenticatedUser } from '../_shared/supabase.ts'

const STOCKTWITS_WIDGET_URL = 'https://api.stocktwits.com/widgets/stream'

function buildWidgetUrl(ticker: string): string {
  const params = new URLSearchParams({
    symbol: ticker,
    width: '300',
    height: '1700',
    domain: 'finviz.com',
    scrollbars: '0',
    streaming: 'true',
    header: '0',
    limit: '24',
  })
  return `${STOCKTWITS_WIDGET_URL}?${params.toString()}`
}

function sanitizeSample(value: string): string {
  const compact = value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  if (compact.length === 0) return '<REDACTED>'

  const redacted = compact
    .replace(/[A-Za-z0-9_@.-]+/g, '<REDACTED>')
    .replace(/\s+/g, ' ')
    .slice(0, 260)

  return redacted.length > 0 ? redacted : '<REDACTED>'
}

function collectUniqueMatches(source: string, regex: RegExp): string[] {
  const matches = new Set<string>()
  for (const match of source.matchAll(regex)) {
    const value = match[1] ?? match[0]
    if (value) matches.add(value)
  }
  return Array.from(matches)
}

function collectDiagnostics(html: string, markdown: string, resolvedUrl: string | null, ticker: string): Record<string, unknown> {
  const messageElements = (
    (html.match(/li\s*\.message/gi) ?? []).length +
    (html.match(/class\s*=\s*["'][^"']*\bmessage\b[^"']*["']/gi) ?? []).length +
    (html.match(/id\s*=\s*["']message[-_][0-9]+["']/gi) ?? []).length
  )

  const messageIds = collectUniqueMatches(html, /(?:id|data-id)\s*=\s*["']message[-_](\d+)["']/gi)
  const messageLinks = collectUniqueMatches(html, /(?:href|src)\s*=\s*["'](?:https?:\/\/[^"']*|\/)?\/message\/(\d+)["']/gi)
  const authors = collectUniqueMatches(html, /class\s*=\s*["'][^"']*\busername\b[^"']*["']/gi)
  const timestamps = collectUniqueMatches(html, /(?:data-time|datetime)\s*=\s*["']([^"']+)["']/gi)
  const bodyElements = collectUniqueMatches(html, /class\s*=\s*["'][^"']*\b(?:body|message-body|message-text|body-text|content|text)\b[^"']*["']/gi)
  const scriptTags = (html.match(/<script\b/gi) ?? []).length
  const applicationJsonScripts = (html.match(/application\/json/gi) ?? []).length
  const nextDataPresent = /__NEXT_DATA__|nextData/i.test(html)

  const sampleTarget = html || markdown
  const sample = sanitizeSample(sampleTarget.slice(0, 260))

  return {
    source: 'stocktwits-widget-diagnostic',
    ticker,
    htmlLength: html.length,
    markdownLength: markdown.length,
    resolvedUrl,
    messageElements,
    messageIds: messageIds.length,
    messageLinks: messageLinks.length,
    authors: authors.length,
    timestamps: timestamps.length,
    bodyElements: bodyElements.length,
    scriptTags,
    applicationJsonScripts,
    nextDataPresent,
    hasStocktwitsWidget: /stocktwits-widget|stocktwits/i.test(html),
    hasMessagesContainer: /messages|message/i.test(html),
    hasMessageList: /li\.message|\bmessage\b|\[id\^="message-"\]/i.test(html),
    hasUsernameSelector: /a\.username|\.username/i.test(html),
    hasTimeSelector: /\.time|\[data-time\]|datetime/i.test(html),
    hasMessageLinkPattern: /\/message\/\d+/i.test(html),
    sample,
    messageOccurrences: (html.match(/\bmessage\b/gi) ?? []).length + (markdown.match(/\bmessage\b/gi) ?? []).length,
    messagesOccurrences: (html.match(/\bmessages\b/gi) ?? []).length + (markdown.match(/\bmessages\b/gi) ?? []).length,
    streamOccurrences: (html.match(/\bstream\b/gi) ?? []).length + (markdown.match(/\bstream\b/gi) ?? []).length,
    conversationOccurrences: (html.match(/\bconversation\b/gi) ?? []).length + (markdown.match(/\bconversation\b/gi) ?? []).length,
    symbolOccurrences: (html.match(/\bsymbol\b/gi) ?? []).length + (markdown.match(/\bsymbol\b/gi) ?? []).length,
    usernameOccurrences: (html.match(/\busername\b/gi) ?? []).length + (markdown.match(/\busername\b/gi) ?? []).length,
    createdAtOccurrences: (html.match(/createdAt/gi) ?? []).length + (markdown.match(/createdAt/gi) ?? []).length,
    created_atOccurrences: (html.match(/created_at/gi) ?? []).length + (markdown.match(/created_at/gi) ?? []).length,
    bodyOccurrences: (html.match(/\bbody\b/gi) ?? []).length + (markdown.match(/\bbody\b/gi) ?? []).length,
    textOccurrences: (html.match(/\btext\b/gi) ?? []).length + (markdown.match(/\btext\b/gi) ?? []).length,
    userOccurrences: (html.match(/\buser\b/gi) ?? []).length + (markdown.match(/\buser\b/gi) ?? []).length,
  }
}

Deno.serve(async (request) => {
  const options = handleOptions(request)
  if (options) return options

  try {
    if (request.method !== 'POST') {
      return jsonResponse({ success: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Use POST' } }, 405, request)
    }

    await requireAuthenticatedUser(request)

    const body = await readJson(request)
    if (!body) {
      return jsonResponse({ success: false, error: { code: 'INVALID_JSON', message: 'Request body must be a JSON object' } }, 400, request)
    }

    const ticker = normalizeTicker(body.ticker)
    if (!ticker) {
      return jsonResponse({ success: false, error: { code: 'INVALID_TICKER', message: 'ticker must be a valid symbol such as NVDA' } }, 400, request)
    }

    const widgetUrl = buildWidgetUrl(ticker)
    const firecrawlClient = createFirecrawlClient()
    const document = await firecrawlClient.scrape(widgetUrl)

    const html = document.html ?? ''
    const markdown = document.markdown ?? ''
    const resolvedUrl = typeof document.metadata?.url === 'string' ? document.metadata.url : null

    return jsonResponse({
      success: true,
      data: {
        ...collectDiagnostics(html, markdown, resolvedUrl, ticker),
        httpStatus: 200,
        contentType: document.metadata && typeof document.metadata.contentType === 'string' ? document.metadata.contentType : null,
      },
    }, 200, request)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR'
    if (message === 'AUTHORIZATION_REQUIRED' || message === 'INVALID_ACCESS_TOKEN' || message === 'BACKEND_CONFIG_MISSING') {
      return jsonResponse({ success: false, error: { code: message, message: 'A valid Supabase access token is required' } }, 401, request)
    }

    if (message.startsWith('Firecrawl')) {
      return jsonResponse({
        success: false,
        error: {
          code: 'FIRECRAWL_ERROR',
          message,
        },
      }, 502, request)
    }

    return jsonResponse({ success: false, error: { code: 'DIAGNOSTIC_ERROR', message } }, 500, request)
  }
})
