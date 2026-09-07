import { finvizScraper } from '../scrape-finviz/scraper.ts'
import { stockTwitsScraper } from '../scrape-stocktwits/scraper.ts'
import { scrapeSecFilings } from '../scrape-sec/scraper.ts'
import { createBackendClient } from '../_shared/supabase.ts'
import { saveFinvizScrapedItems, saveScrapedItem, saveSecScrapedItems } from '../_shared/repository.ts'
import { errorResponse, handleOptions, ok } from '../_shared/response.ts'

const MAX_CONCURRENCY = 3
const FIVE_MINUTES_MS = 5 * 60 * 1000
const FIFTEEN_MINUTES_MS = 15 * 60 * 1000
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
    const persistence = await saveFinvizScrapedItems(items)
    return { ok: true, found: items.length, ...persistence }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'unknown error' }
  }
}

async function runStockTwitsForTicker(ticker: string) {
  const startedAt = Date.now()
  try {
    const items = await stockTwitsScraper.scrape({ ticker })
    let newItems = 0
    let duplicates = 0
    for (const item of items) {
      if (await saveScrapedItem(item) === 'new') newItems += 1
      else duplicates += 1
    }
    const result = { ok: true, firecrawl_status: 'success', found: items.length, new: newItems, duplicate: duplicates, duplicates, duration_ms: Date.now() - startedAt }
    console.info(JSON.stringify({ event: 'stocktwits_transport', ticker, ...result }))
    return result
  } catch (error) {
    const result = { ok: false, firecrawl_status: 'error', found: 0, new: 0, duplicate: 0, duplicates: 0, duration_ms: Date.now() - startedAt, error: error instanceof Error ? error.message : 'unknown error' }
    console.info(JSON.stringify({ event: 'stocktwits_transport', ticker, ...result }))
    return result
  }
}

async function runSecForTicker(ticker: string, rotationIndex: number, watchlistSize: number) {
  const startedAt = Date.now()
  console.info(JSON.stringify({ event: 'sec_started', ticker, cik: null, selected: true, rotationIndex, watchlistSize }))
  try {
    const items = await scrapeSecFilings(ticker)
    const persistence = await saveSecScrapedItems(items)
    const result = { ok: true, found: items.length, ...persistence, rotationIndex, watchlistSize, duration_ms: Date.now() - startedAt }
    console.info(JSON.stringify({ event: 'sec_finished', ticker, cik: items[0]?.metadata.cik ?? null, selected: true, ...result }))
    return result
  } catch (error) {
    const result = { ok: false, found: 0, new: 0, duplicate: 0, rotationIndex, watchlistSize, duration_ms: Date.now() - startedAt, error: error instanceof Error ? error.message : 'unknown error' }
    console.error(JSON.stringify({ event: 'sec_error', ticker, cik: null, selected: true, ...result }))
    return result
  }
}

async function scrapeTicker(ticker: string, runStockTwits: boolean, selectedStockTwitsTicker: string | null, runSec: boolean, selectedSecTicker: string | null, rotationIndex: number, watchlistSize: number) {
  const startedAt = Date.now()
  const finviz = await runFinviz(ticker)
  const stocktwits = runStockTwits
    ? await runStockTwitsForTicker(ticker)
    : { ok: true, skipped: true, reason: '15m_interval', firecrawl_status: 'skipped', found: 0, new: 0, duplicate: 0, duration_ms: 0 }
  const sec = runSec ? await runSecForTicker(ticker, rotationIndex, watchlistSize) : { ok: true, skipped: true, reason: '15m_interval', found: 0, new: 0, duplicate: 0, duration_ms: 0 }
  const result = { ticker, finviz, stocktwits, sec, runStockTwits, selectedStockTwitsTicker, runSec, selectedSecTicker, rotationIndex, watchlistSize, durationMs: Date.now() - startedAt }
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
    const cycleSlot = Math.floor(Date.now() / FIVE_MINUTES_MS)
    const shouldRunStockTwits = cycleSlot % 3 === 0
    const { data, error } = await createBackendClient()
      .from('tracked_stocks')
      .select('ticker')
      .eq('enabled', true)
      .order('ticker', { ascending: true })
    if (error) throw error

    const tickers = (data ?? []).map((row) => row.ticker)
    const stockTwitsSlot = Math.floor(Date.now() / FIFTEEN_MINUTES_MS)
    const rotationIndex = tickers.length > 0 ? stockTwitsSlot % tickers.length : -1
    const selectedStockTwitsTicker = shouldRunStockTwits ? tickers[rotationIndex] ?? null : null
    const selectedSecTicker = shouldRunStockTwits ? tickers[rotationIndex] ?? null : null
    const results: Awaited<ReturnType<typeof scrapeTicker>>[] = []
    let nextIndex = 0

    async function worker() {
      while (nextIndex < tickers.length) {
        const index = nextIndex
        nextIndex += 1
        results.push(await scrapeTicker(tickers[index], tickers[index] === selectedStockTwitsTicker, selectedStockTwitsTicker, tickers[index] === selectedSecTicker, selectedSecTicker, rotationIndex, tickers.length))
      }
    }

    await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENCY, tickers.length) }, () => worker()))
    const result = { source: 'watchlist', tickers: tickers.length, runStockTwits: shouldRunStockTwits, selectedStockTwitsTicker, selectedSecTicker, rotationIndex, watchlistSize: tickers.length, results, durationMs: Date.now() - startedAt }
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
