import { stockTwitsScraper } from './scraper.ts'
import { assertTrackedTicker, saveScrapedItem } from '../_shared/repository.ts'
import { errorResponse, handleOptions, ok, readJson } from '../_shared/response.ts'
import { normalizeTicker } from '../_shared/scraper.ts'
import { requireAuthenticatedUser } from '../_shared/supabase.ts'

Deno.serve(async (request) => {
  const options = handleOptions(request); if (options) return options
  const startedAt = Date.now()
  try {
    if (request.method !== 'POST') return errorResponse('METHOD_NOT_ALLOWED', 'Use POST', 405, request)
    try {
      await requireAuthenticatedUser(request)
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      if (message === 'BACKEND_CONFIG_MISSING') {
        return errorResponse('BACKEND_CONFIG_MISSING', 'Supabase backend configuration is missing', 500, request)
      }
      return errorResponse('UNAUTHORIZED', 'A valid Supabase access token is required', 401, request)
    }
    const body = await readJson(request)
    if (!body) return errorResponse('INVALID_JSON', 'Request body must be a JSON object', 400, request)
    const ticker = normalizeTicker(body.ticker)
    if (!ticker) return errorResponse('INVALID_TICKER', 'ticker must be a valid symbol such as NVDA', 400, request)
    await assertTrackedTicker(ticker)
    console.info(JSON.stringify({ event: 'scrape_started', source: 'stocktwits', ticker }))
    const items = await stockTwitsScraper.scrape({ ticker })
    let newItems = 0
    let duplicates = 0
    for (const item of items) { if (await saveScrapedItem(item) === 'new') newItems += 1; else duplicates += 1 }
    const result = { source: 'stocktwits', ticker, found: items.length, new: newItems, duplicates, durationMs: Date.now() - startedAt }
    console.info(JSON.stringify({ event: 'scrape_finished', ...result }))
    return ok(result, request)
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    console.error(JSON.stringify({ event: 'scrape_failed', source: 'stocktwits', durationMs: Date.now() - startedAt, error: message || 'unknown error' }))
    if (message === 'TICKER_NOT_TRACKED') return errorResponse('TICKER_NOT_TRACKED', 'Ticker is not enabled in tracked_stocks', 404, request)
    if (message.includes('not found or is disabled')) return errorResponse('SOURCE_NOT_CONFIGURED', 'StockTwits source is not configured', 404, request)
    if (message.includes('timed out')) return errorResponse('FIRECRAWL_TIMEOUT', 'The scraping provider timed out', 504, request)
    if (message.startsWith('Firecrawl')) return errorResponse('FIRECRAWL_ERROR', 'The scraping provider failed', 502, request)
    return errorResponse('SCRAPER_ERROR', 'StockTwits scraper failed', 500, request)
  }
})
