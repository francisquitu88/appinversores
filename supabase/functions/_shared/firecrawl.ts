const FIRECRAWL_URL = 'https://api.firecrawl.dev/v1/scrape'

export interface FirecrawlDocument { markdown?: string; html?: string; metadata?: Record<string, unknown> }
export interface FirecrawlClient { scrape(url: string): Promise<FirecrawlDocument> }
export interface FirecrawlOptions { formats?: Array<'html' | 'markdown'> }

function resolveFirecrawlApiKeys(): string[] {
  const configuredKeys = [
    Deno.env.get('FIRECRAWL_API_KEY'),
    Deno.env.get('FIRECRAWL_API_KEY_FALLBACK'),
  ].filter((value): value is string => Boolean(value && value.trim().length > 0))

  const uniqueKeys = [...new Set(configuredKeys)]
  if (uniqueKeys.length === 0) {
    throw new Error('No Firecrawl API key configured: FIRECRAWL_API_KEY or FIRECRAWL_API_KEY_FALLBACK')
  }

  return uniqueKeys
}

function shouldRetryWithFallback(statusCode?: number, errorMessage?: string): boolean {
  if (statusCode && [401, 403, 429].includes(statusCode)) return true
  if (statusCode && statusCode >= 500) return true
  if (!statusCode && errorMessage) {
    const message = errorMessage.toLowerCase()
    return /(timed out|timeout|network|failed to fetch|econnreset|enotfound|aborterror|fetch)/i.test(message)
  }
  return false
}

function getFallbackReason(statusCode?: number, errorMessage?: string): string {
  if (statusCode) {
    if (statusCode === 401) return 'http_401'
    if (statusCode === 403) return 'http_403'
    if (statusCode === 429) return 'http_429'
    if (statusCode >= 500) return 'http_5xx'
  }

  if (errorMessage) {
    const message = errorMessage.toLowerCase()
    if (message.includes('timed out') || message.includes('timeout')) return 'timeout'
    if (message.includes('fetch') || message.includes('network')) return 'network_error'
  }

  return 'provider_error'
}

function getNewsTableDiagnostic(document: FirecrawlDocument) {
  const html = typeof document.html === 'string' ? document.html : ''
  const markdown = typeof document.markdown === 'string' ? document.markdown : ''
  const tableMatch = html.match(/<table\b[^>]*\bid\s*=\s*["']news-table["'][^>]*>[\s\S]*?<\/table>/i)

  if (!tableMatch) {
    return {
      htmlLength: html.length,
      markdownLength: markdown.length,
      newsTableDetected: false,
      newsTableRows: 0,
      firstTimestamp: null,
      lastTimestamp: null,
      tableLinks: 0,
    }
  }

  const tableHtml = tableMatch[0]
  const rows = [...tableHtml.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)].map((match) => match[0])
  const getFirstCellText = (rowHtml: string | undefined) => {
    if (!rowHtml) return null
    const cellMatch = rowHtml.match(/<td\b[^>]*>([\s\S]*?)<\/td>/i)
    if (!cellMatch) return null
    const text = cellMatch[1]
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/\s+/g, ' ')
      .trim()
    return text || null
  }

  return {
    htmlLength: html.length,
    markdownLength: markdown.length,
    newsTableDetected: true,
    newsTableRows: rows.length,
    firstTimestamp: getFirstCellText(rows[0]),
    lastTimestamp: getFirstCellText(rows[rows.length - 1]),
    tableLinks: tableHtml.match(/<a\b[^>]*>/gi)?.length ?? 0,
  }
}

async function fetchFirecrawlDocument(url: string, apiKey: string, options?: FirecrawlOptions): Promise<FirecrawlDocument> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30_000)

  try {
    const response = await fetch(FIRECRAWL_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url,
        formats: options?.formats ?? ['markdown', 'html'],
        onlyMainContent: true,
        maxAge: 0,
      }),
      signal: controller.signal,
    })

    if (!response.ok) {
      throw new Error(`Firecrawl returned HTTP ${response.status}`)
    }

    const payload: unknown = await response.json()
    if (!payload || typeof payload !== 'object' || !('success' in payload) || payload.success !== true || !('data' in payload)) {
      throw new Error('Firecrawl returned an invalid response')
    }

    if (!payload.data || typeof payload.data !== 'object') {
      throw new Error('Firecrawl returned invalid document data')
    }

    const document = payload.data as FirecrawlDocument
    console.info(JSON.stringify(getNewsTableDiagnostic(document)))
    return document
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Firecrawl request timed out')
    }
    throw error instanceof Error ? error : new Error('Firecrawl request failed')
  } finally {
    clearTimeout(timeout)
  }
}

export function createFirecrawlClient(options?: FirecrawlOptions): FirecrawlClient {
  const apiKeys = resolveFirecrawlApiKeys()

  return {
    async scrape(url) {
      let lastError: Error | null = null

      for (let index = 0; index < apiKeys.length; index += 1) {
        const apiKey = apiKeys[index]
        const isFallback = index > 0

        try {
          return await fetchFirecrawlDocument(url, apiKey, options)
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Firecrawl request failed'
          lastError = error instanceof Error ? error : new Error(message)

          const statusCodeMatch = message.match(/HTTP\s+(\d{3})/i)
          const statusCode = statusCodeMatch ? Number(statusCodeMatch[1]) : undefined

          if (isFallback || !shouldRetryWithFallback(statusCode, message) || index === apiKeys.length - 1) {
            break
          }

          console.info(JSON.stringify({
            event: 'firecrawl_fallback',
            reason: getFallbackReason(statusCode, message),
            usedFallback: true,
          }))
        }
      }

      throw lastError ?? new Error('Firecrawl request failed')
    },
  }
}
