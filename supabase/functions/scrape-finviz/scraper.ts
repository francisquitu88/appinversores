import { createFirecrawlClient, type FirecrawlDocument } from '../_shared/firecrawl.ts'
import { generateContentHash } from '../_shared/hash.ts'
import { resolveSourceId } from '../_shared/repository.ts'
import { normalizeTicker } from '../_shared/scraper.ts'
import type { Scraper, ScrapedItemDraft } from '../_shared/scraper.ts'

const FINVIZ_URL = 'https://finviz.com/quote.ashx?t='
const FINVIZ_TIME_ZONE = 'America/New_York'
const FINVIZ_MAX_NEWS_ROWS = 300
const KURA_DIRECT_FETCH_TIMEOUT_MS = 10_000

function normalizeText(value: string | null | undefined): string | null {
  if (!value) return null
  const cleaned = value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned.length > 0 ? cleaned : null
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
}

function getFinvizToday(): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: FINVIZ_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

function parseDateContext(rawDate: string): { year: number; month: number; day: number; value: string } | null {
  const match = rawDate.match(/^([A-Za-z]{3})-(\d{2})-(\d{2})$/i)
  if (!match) return null
  const [, monthName, dayText, yearText] = match
  const monthIndex = new Date(`${monthName} 1, 2000`).getMonth()
  const day = Number(dayText)
  const yearShort = Number(yearText)
  const year = yearShort >= 50 ? 1900 + yearShort : 2000 + yearShort
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()
  if (monthIndex < 0 || day < 1 || day > daysInMonth) return null
  return { year, month: monthIndex + 1, day, value: `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}` }
}

function toIsoInFinvizTimeZone(dateContext: string, hour: number, minute: number): string | null {
  const dateMatch = dateContext.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!dateMatch || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null
  const [, yearText, monthText, dayText] = dateMatch
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth) return null
  const wallClockUtc = Date.UTC(year, month - 1, day, hour, minute)
  const offsetParts = new Intl.DateTimeFormat('en-US', { timeZone: FINVIZ_TIME_ZONE, timeZoneName: 'shortOffset' }).formatToParts(new Date(wallClockUtc))
  const offset = offsetParts.find((part) => part.type === 'timeZoneName')?.value.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?$/)
  if (!offset) return null
  const offsetMinutes = (Number(offset[2]) * 60 + Number(offset[3] ?? 0)) * (offset[1] === '-' ? -1 : 1)
  return new Date(wallClockUtc - offsetMinutes * 60_000).toISOString()
}

export function parseFinvizTimestamp(rawValue: string | null, currentNewsDate: string | null): { published_at: string | null; rawTimestamp: string | null; currentNewsDate: string | null } {
  const normalized = normalizeText(rawValue)
  if (!normalized) return { published_at: null, rawTimestamp: null, currentNewsDate }
  const dateTimeMatch = normalized.match(/^([A-Za-z]{3}-\d{2}-\d{2})\s+(\d{1,2}):(\d{2})(AM|PM)$/i)
  if (dateTimeMatch) {
    const [, dateText, hoursText, minutesText, meridiem] = dateTimeMatch
    const dateContext = parseDateContext(dateText)
    const hours = Number(hoursText) % 12 + (meridiem.toUpperCase() === 'PM' ? 12 : 0)
    const minutes = Number(minutesText)
    return { published_at: dateContext ? toIsoInFinvizTimeZone(dateContext.value, hours, minutes) : null, rawTimestamp: normalized, currentNewsDate: dateContext?.value ?? currentNewsDate }
  }
  const todayTimeMatch = normalized.match(/^Today\s+(\d{1,2}):(\d{2})(AM|PM)$/i)
  const timeOnlyMatch = normalized.match(/^(\d{1,2}):(\d{2})(AM|PM)$/i)
  const timeMatch = todayTimeMatch ?? timeOnlyMatch
  if (timeMatch) {
    const [, hoursText, minutesText, meridiem] = timeMatch
    const nextDate = todayTimeMatch ? currentNewsDate ?? getFinvizToday() : currentNewsDate
    if (!nextDate) return { published_at: null, rawTimestamp: normalized, currentNewsDate: null }
    const hours = Number(hoursText) % 12 + (meridiem.toUpperCase() === 'PM' ? 12 : 0)
    const minutes = Number(minutesText)
    return { published_at: toIsoInFinvizTimeZone(nextDate, hours, minutes), rawTimestamp: normalized, currentNewsDate: nextDate }
  }
  return { published_at: null, rawTimestamp: normalized, currentNewsDate }
}

function extractNewsRows(tableHtml: string): string[] {
  return [...tableHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((match) => match[1] ?? '').filter((rowHtml) => rowHtml.trim().length > 0)
}

function resolveDirectNewsUrls(html: string, baseUrl: string): string {
  return html.replace(/(<table\b[^>]*\b(?:id|class)\s*=\s*["'][^"']*\bnews-table\b[^"']*["'][^>]*>[\s\S]*?<\/table>)/i, (tableHtml) => tableHtml.replace(/(\bhref\s*=\s*["'])([^"']+)(["'])/gi, (_match, prefix: string, href: string, suffix: string) => {
    try {
      return `${prefix}${new URL(href, baseUrl).toString()}${suffix}`
    } catch {
      return `${prefix}${href}${suffix}`
    }
  }))
}

const KNOWN_UI_TITLES = new Set([
  'overview',
  'short interest',
  'financials',
  'filings',
  'filingslatest filings',
  'set alert',
  'add to portfolio',
  'scroll to statements',
  'dividend est.',
  'technology',
  'nvda logo',
  'nvidia corp',
  'try elite free for 7 days',
])

function looksLikeNumericTitle(titleText: string | null): boolean {
  const value = normalizeText(titleText)
  if (!value) return false
  return /^\d+(?:[.,]\d+)?$/.test(value.trim())
}

function isKnownUiTitle(titleText: string | null): boolean {
  const normalized = normalizeText(titleText)
  if (!normalized) return false
  return KNOWN_UI_TITLES.has(normalized.toLowerCase())
}

function isNavigationUrl(url: string): boolean {
  const value = url.trim()
  if (!value) return true

  const lower = value.toLowerCase()
  if (lower.includes('finviz.com/stock') || lower.includes('finviz.com/quote.ashx') || lower.includes('finviz.com/register') || lower.includes('finviz.com/elite') || lower.includes('finviz.com/save_to_portfolio') || lower.includes('finviz.com/screener') || lower.includes('logo.finviz.com') || lower.includes('nvidia.com/') || lower.includes('nvidia.com')) {
    return true
  }

  try {
    const parsed = new URL(value)
    const pathname = parsed.pathname.toLowerCase()
    if (parsed.hostname.toLowerCase().includes('logo.finviz.com')) return true
    if (parsed.hostname.toLowerCase() === 'finviz.com' || parsed.hostname.toLowerCase().endsWith('.finviz.com')) {
      return !pathname.startsWith('/news/')
    }
    if (parsed.hostname.toLowerCase().includes('nvidia.com')) return true
    if (parsed.hostname.toLowerCase().includes('finviz.com') && pathname.includes('/stock')) return true
  } catch {
    if (lower.startsWith('/stock') || lower.startsWith('/quote.ashx') || lower.startsWith('/register') || lower.startsWith('/elite') || lower.startsWith('/save_to_portfolio') || lower.startsWith('/screener') || lower.startsWith('/portfolio')) {
      return true
    }
  }

  return false
}

function extractLinksFromCell(cellHtml: string): { href: string | null; text: string | null } {
  const hrefMatch = cellHtml.match(/<a\b[^>]*\shref\s*=\s*["']([^"']+)["'][^>]*>/i)
  const textMatch = cellHtml.match(/<a\b[^>]*>([\s\S]*?)<\/a>/i)

  const href = hrefMatch?.[1] ?? null
  const text = textMatch ? normalizeText(decodeHtmlEntities(textMatch[1])) : null

  return { href, text }
}

function extractProviderFromTitle(titleText: string | null): string | null {
  const normalized = normalizeText(titleText)
  if (!normalized) return null

  const parentheticalMatch = normalized.match(/^(.*)\s+\(([^()]+)\)\s*$/)
  if (parentheticalMatch?.[2]) return parentheticalMatch[2].trim() || null

  return null
}

function extractProviderFromCell(cellHtml: string): string | null {
  const providerText = normalizeText(decodeHtmlEntities(cellHtml.replace(/<[^>]+>/g, ' ')))
  if (!providerText) return null

  const parentheticalMatch = providerText.match(/\(([^()]+)\)\s*$/)
  if (parentheticalMatch?.[1]) return parentheticalMatch[1].trim() || null

  const trimmed = providerText.trim()
  if (/^(?:Reuters|Stocktwits|Moby|Moneywise|DigiTimes|Bloomberg|Pitchbook|Investor's Business Daily|Associated Press|Barrons\.com)$/i.test(trimmed)) {
    return trimmed
  }

  return null
}

function extractNews(document: FirecrawlDocument, ticker: string, sourceId: string): ScrapedItemDraft[] {
  const html = document.html ?? document.markdown ?? ''
  if (!html || html.trim().length === 0) return []

  const tableMatch = html.match(/<table\b[^>]*\b(?:id|class)\s*=\s*["'][^"']*\bnews-table\b[^"']*["'][^>]*>[\s\S]*?<\/table>/i)
  if (!tableMatch) {
    return []
  }

  const tableHtml = tableMatch[0]
  const tableTickerMatch = tableHtml.match(/data-ticker\s*=\s*["']([^"']+)["']/i)
  const tableTicker = tableTickerMatch ? normalizeTicker(tableTickerMatch[1]) : null
  const rows = extractNewsRows(tableHtml).slice(0, FINVIZ_MAX_NEWS_ROWS)

  if (tableTicker && tableTicker !== ticker) {
    return []
  }

  const items: ScrapedItemDraft[] = []
  const seenUrls = new Set<string>()
  let currentNewsDate: string | null = getFinvizToday()
  for (const row of rows) {
    const cellMatches = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => match[1] ?? '')
    if (cellMatches.length < 2) {
      continue
    }

    const timestampCell = cellMatches[0] ?? ''
    const articleCell = cellMatches[1] ?? ''
    const providerCell = cellMatches[2] ?? ''

    const articleLink = extractLinksFromCell(articleCell)
    const timestamp = normalizeText(decodeHtmlEntities(timestampCell.replace(/<[^>]+>/g, ' ')))
    const title = normalizeText(articleLink.text)
    const url = articleLink.href ? articleLink.href.trim() : ''

    if (!timestamp && !articleLink.href) {
      continue
    }

    if (!articleLink.href) {
      continue
    }

    if (!title) {
      continue
    }

    if (isKnownUiTitle(title) || looksLikeNumericTitle(title)) {
      continue
    }

    if (isNavigationUrl(url)) {
      continue
    }

    try {
      const parsedUrl = new URL(url)
      if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        continue
      }
    } catch {
      continue
    }

    if (!title || seenUrls.has(url)) {
      continue
    }

    const provider = extractProviderFromCell(providerCell) ?? extractProviderFromCell(articleCell) ?? extractProviderFromTitle(title)
    const { published_at, rawTimestamp, currentNewsDate: nextNewsDate } = parseFinvizTimestamp(timestamp, currentNewsDate)
    currentNewsDate = nextNewsDate ?? currentNewsDate

    seenUrls.add(url)
    items.push({
      source_id: sourceId,
      ticker,
      item_type: 'news',
      title,
      content: null,
      author: null,
      url,
      published_at,
      scraped_at: new Date().toISOString(),
      content_hash: '',
      metadata: {
        extractor: 'finviz-news-table',
        provider: provider ?? null,
        raw_timestamp: rawTimestamp ?? timestamp ?? null,
      },
    })
  }

  return items
}

export const finvizScraper: Scraper = {
  source: 'finviz',
  async scrape({ ticker }) {
    const sourceId = await resolveSourceId('finviz')
    const requestedTicker = normalizeTicker(ticker) ?? ticker.toUpperCase()
    const finvizUrl = `${FINVIZ_URL}${encodeURIComponent(requestedTicker)}`
    const startedAt = Date.now()
    let items: ScrapedItemDraft[] = []
    let directStatus: number | null = null
    let directRows = 0
    let directSucceeded = false

    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), KURA_DIRECT_FETCH_TIMEOUT_MS)
      let response: Response
      try {
        response = await fetch(finvizUrl, {
          headers: {
            Accept: 'text/html,application/xhtml+xml',
            'Accept-Language': 'en-US,en;q=0.9',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36',
          },
          redirect: 'follow',
          signal: controller.signal,
        })
      } finally {
        clearTimeout(timeout)
      }

      directStatus = response.status
      const contentType = response.headers.get('content-type')
      const html = await response.text()
      const newsTableDetected = /<table\b[^>]*\b(?:id|class)\s*=\s*["'][^"']*\bnews-table\b[^"']*["'][^>]*>/i.test(html)
      if (response.ok && contentType && /(?:text\/html|application\/xhtml\+xml)/i.test(contentType) && newsTableDetected) {
        const normalizedHtml = resolveDirectNewsUrls(html, response.url)
        const tableMatch = normalizedHtml.match(/<table\b[^>]*\b(?:id|class)\s*=\s*["'][^"']*\bnews-table\b[^"']*["'][^>]*>[\s\S]*?<\/table>/i)
        directRows = tableMatch ? extractNewsRows(tableMatch[0]).length : 0
        items = extractNews({ html: normalizedHtml }, requestedTicker, sourceId)
        directSucceeded = items.length > 0
      }
    } catch {
      directSucceeded = false
    }

    if (directSucceeded) {
      console.info(JSON.stringify({ event: 'finviz_transport', ticker: requestedTicker, method: 'direct', status: directStatus, rows: directRows, items: items.length, durationMs: Date.now() - startedAt }))
    } else {
      const document = await createFirecrawlClient().scrape(finvizUrl)
      items = extractNews(document, requestedTicker, sourceId)
      console.info(JSON.stringify({ event: 'finviz_transport', ticker: requestedTicker, method: 'firecrawl', reason: 'direct_fetch_failed', items: items.length, durationMs: Date.now() - startedAt }))
    }

    for (const item of items) {
      item.content_hash = await generateContentHash({
        source: 'finviz',
        ticker: item.ticker,
        title: item.title,
        content: item.content,
        url: item.url,
      })
    }

    return items
  },
}
