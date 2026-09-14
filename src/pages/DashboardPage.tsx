import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, Search, Trash2, X } from 'lucide-react'
import type { Session } from '@supabase/supabase-js'
import { supabase, updateWatchlist } from '../lib/supabase'
import { getDashboardData } from '../lib/queries/company'
import type { FinvizAnalystRating, FinvizInsiderTrade, ScrapedItem, TickerSummary, TrackedStock } from '../types'
import { useI18n } from '../i18n/useI18n'

const dateTimeFormatter = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })
function isSec(item: ScrapedItem) { return item.metadata.source === 'SEC' || typeof item.metadata.accessionNumber === 'string' }
function effectiveDate(item: ScrapedItem) { return new Date(item.published_at ?? item.scraped_at).getTime() }
function displayDate(value: string | null) { return value ? dateTimeFormatter.format(new Date(value)) : 'Awaiting first update' }

export function DashboardPage({ session, onNavigate }: { session: Session; onNavigate: (path: string) => void }) {
  const { t } = useI18n()
  const [stocks, setStocks] = useState<TrackedStock[]>([])
  const [items, setItems] = useState<ScrapedItem[]>([])
  const [ratings, setRatings] = useState<FinvizAnalystRating[]>([])
  const [insiderTrades, setInsiderTrades] = useState<FinvizInsiderTrade[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [tickerInput, setTickerInput] = useState('')
  const [mutatingTicker, setMutatingTicker] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!supabase) return
    setLoading(true); setError(false)
    try { const result = await getDashboardData(supabase); setStocks(result.stocks); setItems(result.items); setRatings(result.ratings); setInsiderTrades(result.insiderTrades) } catch { setError(true) } finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  const summaries = useMemo(() => {
    const result = new Map<string, TickerSummary>()
    stocks.forEach((stock) => result.set(stock.ticker, { ticker: stock.ticker, totalNews: 0, totalFilings: 0, totalRatings: 0, totalInsiders: 0, latestNews: null, latestRating: null, latestInsider: null, lastUpdated: null }))
    items.forEach((item) => { if (!item.ticker || !result.has(item.ticker) || item.item_type === 'post') return; const summary = result.get(item.ticker)!; if (isSec(item)) summary.totalFilings += 1; else summary.totalNews += 1; if (!summary.lastUpdated || effectiveDate(item) > new Date(summary.lastUpdated).getTime()) summary.lastUpdated = item.published_at ?? item.scraped_at })
    ratings.forEach((item) => { const summary = item.ticker ? result.get(item.ticker) : null; if (!summary) return; summary.totalRatings += 1; if (!summary.latestRating || item.rating_date > summary.latestRating) summary.latestRating = item.rating_date })
    insiderTrades.forEach((item) => { const summary = result.get(item.ticker); if (!summary) return; summary.totalInsiders += 1; if (!summary.latestInsider || item.transaction_date > summary.latestInsider) summary.latestInsider = item.transaction_date })
    return result
  }, [insiderTrades, items, ratings, stocks])

  async function addTicker(event: React.FormEvent<HTMLFormElement>) { event.preventDefault(); const ticker = tickerInput.trim().toUpperCase(); if (!ticker || !session || !supabase) return; setMutatingTicker(ticker); setError(false); try { await updateWatchlist('enable', ticker, session.access_token); setTickerInput(''); await load() } catch { setError(true) } finally { setMutatingTicker(null) } }
  async function removeTicker(ticker: string) { if (!session) return; setMutatingTicker(ticker); try { await updateWatchlist('disable', ticker, session.access_token); await load() } catch { setError(true) } finally { setMutatingTicker(null) } }

  return <>
    <section className="page-heading simple-heading"><div><h1>{t('watchlist')}</h1></div></section>
    {error && <div className="error-banner"><X size={17} />Unable to load market data.</div>}
    <section className="watchlist-section clean-watchlist"><div className="section-topline"><h2>{t('trackedCompanies')}</h2><span className="counter">{stocks.length} {t('active')}</span></div>{loading ? <div className="workspace-empty">{t('loading')}</div> : <div className="company-list">{stocks.map((stock) => { const summary = summaries.get(stock.ticker)!; return <div key={stock.id} className="company-row" role="button" tabIndex={0} onClick={() => onNavigate(`/company/${stock.ticker}`)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') onNavigate(`/company/${stock.ticker}`) }}><span className="company-row-symbol">{stock.ticker}</span><span className="company-row-name">{stock.company_name ?? 'Tracked security'}</span><span><b>{summary.totalNews}</b> {t('news')}<small>{summary.lastUpdated ? displayDate(summary.lastUpdated) : '-'}</small></span><span><b>{summary.totalFilings}</b> SEC<small>{summary.lastUpdated ? displayDate(summary.lastUpdated) : '-'}</small></span><span><b>{summary.totalRatings}</b> {t('analystRatings')}<small>{summary.latestRating ?? '-'}</small></span><span><b>{summary.totalInsiders}</b> {t('insiderTrading')}<small>{summary.latestInsider ?? '-'}</small></span><button className="company-row-remove" title={`Remove ${stock.ticker}`} aria-label={`Remove ${stock.ticker}`} disabled={mutatingTicker !== null} onClick={(event) => { event.stopPropagation(); void removeTicker(stock.ticker) }}><Trash2 size={14} /></button></div> })}<form className="add-company-row" onSubmit={addTicker}><Search size={16} /><input placeholder={t('tickerSearch')} aria-label={t('tickerSearch')} value={tickerInput} onChange={(event) => setTickerInput(event.target.value)} /><button title={t('addCompany')} aria-label={t('addCompany')} disabled={!tickerInput.trim() || mutatingTicker !== null}><Plus size={18} /></button></form></div>}</section>
  </>
}
