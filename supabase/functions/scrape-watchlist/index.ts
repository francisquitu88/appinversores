import { finvizScraper } from '../scrape-finviz/scraper.ts'
import { stockTwitsScraper } from '../scrape-stocktwits/scraper.ts'
import { createBackendClient } from '../_shared/supabase.ts'
import { saveFinvizScrapedItem, saveScrapedItem } from '../_shared/repository.ts'
import { errorResponse, handleOptions, ok } from '../_shared/response.ts'

const MAX_CONCURRENCY = 3
let cycleRunning = false

function isAuthorized(request: Request): boolean {
  const rawKeys = Deno.env.get('SUPABASE_SECRET_KEYS')
  const suppliedKey = request.headers.get('apikey') ?? ''
  if (!rawKeys || !suppliedKey) return false

  try {
    const keys = JSON.parse(rawKeys) as Record<string, unknown>
    const configuredKey = keys.watchlistscheduler
    return typeof configuredKey === 'string' && configuredKey.length > 0 && suppliedKey === configuredKey
  } catch {
    return false
  }
}

async function runFinviz(ticker: string) {
  try {
    const items = await finvizScraper.scrape({ ticker })
    let newItems = 0
    let duplicates = 0
    let updated = 0
    for (const item of items) {
      const result = await saveFinvizScrapedItem(item)
      if (result === 'new') newItems += 1
      else if (result === 'updated') updated += 1
      else duplicates += 1
    }
    return { ok: true, found: items.length, new: newItems, duplicates, updated }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'unknown error' }
  }
}

async function runStockTwits(ticker: string) {
  try {
    const items = await stockTwitsScraper.scrape({ ticker })
    let newItems = 0
    let duplicates = 0
    for (const item of items) {
      if (await saveScrapedItem(item) === 'new') newItems += 1
      else duplicates += 1
    }
    return { ok: true, found: items.length, new: newItems, duplicates }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'unknown error' }
  }
}

async function scrapeTicker(ticker: string) {
  const startedAt = Date.now()
  const finviz = await runFinviz(ticker)
  const stocktwits = await runStockTwits(ticker)
  const result = { ticker, finviz, stocktwits, durationMs: Date.now() - startedAt }
  console.info(JSON.stringify({ event: 'watchlist_ticker_finished', ...result }))
  return result
}

Deno.serve(async (request) => {
  const options = handleOptions(request)
  if (options) return options
  if (request.method !== 'POST') return errorResponse('METHOD_NOT_ALLOWED', 'Use POST', 405, request)
  if (!isAuthorized(request)) return errorResponse('UNAUTHORIZED', 'Internal scheduler authorization required', 401, request)
  if (cycleRunning) return errorResponse('CYCLE_IN_PROGRESS', 'A watchlist cycle is already running', 409, request)

  const startedAt = Date.now()
  cycleRunning = true
  try {
    const { data, error } = await createBackendClient()
      .from('tracked_stocks')
      .select('ticker')
      .eq('enabled', true)
      .order('ticker', { ascending: true })
    if (error) throw error

    const tickers = (data ?? []).map((row) => row.ticker)
    const results: Awaited<ReturnType<typeof scrapeTicker>>[] = []
    let nextIndex = 0

    async function worker() {
      while (nextIndex < tickers.length) {
        const index = nextIndex
        nextIndex += 1
        results.push(await scrapeTicker(tickers[index]))
      }
    }

    await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENCY, tickers.length) }, () => worker()))
    const result = { source: 'watchlist', tickers: tickers.length, results, durationMs: Date.now() - startedAt }
    console.info(JSON.stringify({ event: 'watchlist_scrape_finished', ...result }))
    return ok(result, request)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error'
    console.error(JSON.stringify({ event: 'watchlist_scrape_failed', durationMs: Date.now() - startedAt, error: message }))
    return errorResponse('WATCHLIST_SCRAPER_ERROR', 'Watchlist scraping cycle failed', 500, request)
  } finally {
    cycleRunning = false
  }
})
