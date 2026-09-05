import { createFirecrawlClient } from '../_shared/firecrawl.ts'
import { generateContentHash } from '../_shared/hash.ts'
import { resolveSourceId } from '../_shared/repository.ts'
import { normalizeTicker } from '../_shared/scraper.ts'
import type { Scraper, ScrapedItemDraft } from '../_shared/scraper.ts'

const STOCKTWITS_WIDGET_URL = 'https://api.stocktwits.com/widgets/stream'

function normalizeText(value: string | null | undefined): string | null {
  if (!value) return null
  const cleaned = value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()
  return cleaned.length > 0 ? cleaned : null
}

function stripHtmlTags(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/?(p|div|span|li|ul|ol|article|section|strong|b|em|i|a|h[1-6])\b[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

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

function getMessageIdFromHref(value: string | null): string | null {
  if (!value) return null

  try {
    const parsed = new URL(value, 'https://stocktwits.com')
    const match = parsed.pathname.match(/\/message\/(\d+)/i)
    if (match?.[1]) return match[1]
  } catch {
    // Ignore malformed URLs and fall through to regex fallback.
  }

  const fallback = value.match(/\/message\/(\d+)/i)
  return fallback?.[1] ?? null
}

function extractMessageIdFromHtml(value: string): string | null {
  const directMatch = value.match(/(?:id|data-id)\s*=\s*["']message[-_](\d+)["']/i)
  if (directMatch?.[1]) return directMatch[1]

  const hrefMatch = value.match(/href\s*=\s*["']([^"']+)["']/i)
  const messageId = getMessageIdFromHref(hrefMatch?.[1] ?? null)
  if (messageId) return messageId

  return null
}

function extractAuthorFromHtml(value: string): string | null {
  const authorMatch = value.match(/<a[^>]*class=["'][^"']*\busername\b[^"']*["'][^>]*>([\s\S]*?)<\/a>/i)
  if (!authorMatch?.[1]) return null

  const author = normalizeText(stripHtmlTags(authorMatch[1]))
  return author ?? null
}

function getOffsetMinutesForTimeZone(date: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'shortOffset',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })

  const timeZoneName = formatter.formatToParts(date).find((part) => part.type === 'timeZoneName')?.value ?? 'GMT'
  const match = timeZoneName.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?$/i)
  if (!match) return 0

  const [, sign, hours, minutes = '0'] = match
  const offsetMinutes = (Number(hours) * 60) + Number(minutes)
  return sign === '-' ? -offsetMinutes : offsetMinutes
}

function parseHumanTimestamp(value: string): Date | null {
  const normalized = value
    .replace(/&nbsp;/gi, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const monthMatch = normalized.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:\s*,)?\s+at\s+(\d{1,2}):(\d{2})\s*(AM|PM)/i)
  if (!monthMatch) return null

  const monthNames: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  }

  const monthKey = monthMatch[1].slice(0, 3).toLowerCase()
  const monthIndex = monthNames[monthKey]
  if (monthIndex === undefined) return null

  const day = Number(monthMatch[2])
  let hours = Number(monthMatch[3])
  const minutes = Number(monthMatch[4])
  const meridiem = monthMatch[5].toUpperCase()
  if (meridiem === 'PM' && hours < 12) hours += 12
  if (meridiem === 'AM' && hours === 12) hours = 0

  const now = new Date()
  const currentYear = now.getFullYear()
  let year = currentYear

  const candidateUtc = new Date(Date.UTC(year, monthIndex, day, hours, minutes, 0, 0))
  const offsetMinutes = getOffsetMinutesForTimeZone(candidateUtc, 'America/New_York')
  const currentUtc = Date.now()
  const utcDate = new Date(candidateUtc.getTime() - offsetMinutes * 60_000)

  if (utcDate.getTime() > currentUtc + 7 * 24 * 60 * 60 * 1000) {
    year -= 1
    const fallbackUtc = new Date(Date.UTC(year, monthIndex, day, hours, minutes, 0, 0))
    const fallbackOffsetMinutes = getOffsetMinutesForTimeZone(fallbackUtc, 'America/New_York')
    return new Date(fallbackUtc.getTime() - fallbackOffsetMinutes * 60_000)
  }

  return utcDate
}

function parseTimestampCandidate(value: string): string | null {
  const normalized = value
    .replace(/&nbsp;/gi, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!normalized) return null

  const numericValue = Number(normalized)
  if (Number.isFinite(numericValue)) {
    const millis = normalized.length >= 13 ? numericValue : numericValue * 1000
    const date = new Date(millis)
    if (!Number.isNaN(date.getTime())) return date.toISOString()
  }

  const isoDate = new Date(normalized)
  if (!Number.isNaN(isoDate.getTime())) return isoDate.toISOString()

  const humanDate = parseHumanTimestamp(normalized)
  if (humanDate && !Number.isNaN(humanDate.getTime())) return humanDate.toISOString()

  return null
}

function extractPublishedAtFromHtml(value: string): { published_at: string | null; raw_timestamp: string | null } {
  const patterns = [
    /(?:data-time|datetime|data-created-at|data-posted-at)\s*=\s*["']([^"']+)["']/i,
    /<time\b[^>]*\s(?:datetime|data-time|data-created-at|data-posted-at)\s*=\s*["']([^"']+)["'][^>]*>/i,
    /<time\b[^>]*>([\s\S]*?)<\/time>/i,
  ]

  for (const pattern of patterns) {
    const match = value.match(pattern)
    if (!match) continue

    const candidate = (match[1] ?? match[0] ?? '').trim()
    if (!candidate) continue

    const parsedDate = parseTimestampCandidate(candidate)
    if (parsedDate) return { published_at: parsedDate, raw_timestamp: candidate }
  }

  const textTimestampMatch = value.match(/(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.?\s+\d{1,2}(?:,)?\s+at\s+\d{1,2}:\d{2}\s*(?:AM|PM)/i)
  if (textTimestampMatch) {
    const parsedDate = parseTimestampCandidate(textTimestampMatch[0])
    if (parsedDate) return { published_at: parsedDate, raw_timestamp: textTimestampMatch[0].trim() }
  }

  return { published_at: null, raw_timestamp: null }
}

function extractTickerFromText(value: string | null, fallbackTicker: string): string | null {
  if (!value) return normalizeTicker(fallbackTicker)

  for (const match of value.matchAll(/\$([A-Z][A-Z0-9.-]{0,9})/g)) {
    const normalized = normalizeTicker(match[1])
    if (normalized) return normalized
  }

  const symbolMatch = value.match(/\/symbol\/([A-Z0-9.-]+)/i)?.[1]
  if (symbolMatch) {
    const normalized = normalizeTicker(symbolMatch)
    if (normalized) return normalized
  }

  return normalizeTicker(fallbackTicker)
}

function extractTickerFromHtml(value: string, fallbackTicker: string): string | null {
  const symbolMatch = value.match(/\/symbol\/([A-Z0-9.-]+)/i)?.[1]
  if (symbolMatch) {
    const normalized = normalizeTicker(symbolMatch)
    if (normalized) return normalized
  }

  return extractTickerFromText(stripHtmlTags(value), fallbackTicker)
}

function cleanWidgetContent(value: string, fallbackTicker: string): string | null {
  const cleaned = value
    .replace(/\$[A-Z][A-Z0-9.-]{0,9}/g, ' ')
    .replace(new RegExp(`\\$${fallbackTicker}`, 'gi'), ' ')
    .replace(/Read the full conversation/gi, ' ')
    .replace(/Reply/gi, ' ')
    .replace(/https?:\/\/stocktwits\.com\/[^\s]+/gi, ' ')
    .replace(/\s+·\s+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return cleaned.length > 0 ? cleaned : null
}

function extractContentFromHtml(value: string, fallbackTicker: string): string | null {
  const contentPatterns = [
    /<[^>]+class=["'][^"']*(?:body|message-body|content|text|body-text|message-text)[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i,
    /<p\b[^>]*>([\s\S]*?)<\/p>/i,
    /<[^>]+>([\s\S]*?)<\/[^>]+>/i,
  ]

  for (const pattern of contentPatterns) {
    const contentMatch = value.match(pattern)
    const candidate = contentMatch?.[1] ?? value
    const normalized = normalizeText(stripHtmlTags(candidate))
    if (!normalized) continue

    const cleaned = cleanWidgetContent(normalized, fallbackTicker)
    if (cleaned) return cleaned
  }

  return null
}

function parseWidgetMessages(html: string, ticker: string, sourceId: string): ScrapedItemDraft[] {
  if (!html || html.trim().length === 0) return []

  const patterns: RegExp[] = [
    /<li\b[^>]*class=["'][^"']*\bmessage\b[^"']*["'][^>]*>[\s\S]*?<\/li>/gi,
    /<[^>]+\b(?:id|data-id)\s*=\s*["']message[-_](\d+)["'][^>]*>[\s\S]*?<\/[^>]+>/gi,
    /<[^>]+\bclass=["'][^"']*\bmessage\b[^"']*["'][^>]*>[\s\S]*?<\/[^>]+>/gi,
  ]

  const blocks = new Map<string, string>()
  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      const raw = match[0] ?? ''
      if (!raw) continue

      const messageId = extractMessageIdFromHtml(raw)
      if (!messageId || blocks.has(messageId)) continue

      blocks.set(messageId, raw)
    }
  }

  const items: ScrapedItemDraft[] = []
  for (const [messageId, raw] of blocks.entries()) {
    const resolvedTicker = extractTickerFromHtml(raw, ticker)
    const content = extractContentFromHtml(raw, resolvedTicker ?? ticker)
    const timestampInfo = extractPublishedAtFromHtml(raw)

    items.push({
      source_id: sourceId,
      ticker: resolvedTicker ?? normalizeTicker(ticker) ?? null,
      item_type: 'post',
      title: null,
      content,
      author: extractAuthorFromHtml(raw),
      url: `https://stocktwits.com/message/${messageId}`,
      published_at: timestampInfo.published_at,
      scraped_at: new Date().toISOString(),
      content_hash: '',
      metadata: {
        extractor: 'stocktwits-widget',
        widget_domain: 'finviz.com',
        message_id: messageId,
        ...(timestampInfo.raw_timestamp ? { raw_timestamp: timestampInfo.raw_timestamp } : {}),
      },
    })
  }

  return items
}

export const stockTwitsScraper: Scraper = {
  source: 'stocktwits',
  async scrape({ ticker }) {
    const sourceId = await resolveSourceId('stocktwits')
    const normalizedTicker = normalizeTicker(ticker) ?? ticker.toUpperCase()
    const widgetUrl = buildWidgetUrl(normalizedTicker)
    const firecrawlClient = createFirecrawlClient({ formats: ['html'] })
    const document = await firecrawlClient.scrape(widgetUrl)
    const html = document.html ?? document.markdown ?? ''

    if (!html || html.trim().length === 0) {
      throw new Error('StockTwits widget returned empty HTML')
    }

    const items = parseWidgetMessages(html, normalizedTicker, sourceId)

    console.info(JSON.stringify({
      event: 'stocktwits_widget_diagnostic',
      ticker: normalizedTicker,
      htmlLength: html.length,
      messageBlocksFound: items.length,
      messagesWithId: items.filter((item) => item.metadata.message_id).length,
      messagesWithAuthor: items.filter((item) => item.author).length,
      messagesWithContent: items.filter((item) => item.content).length,
    }))

    for (const item of items) {
      item.content_hash = await generateContentHash({
        source: 'stocktwits',
        ticker: item.ticker,
        title: item.title,
        content: item.content,
        url: item.url,
      })
    }

    return items
  },
}
