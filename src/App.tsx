import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { ArrowUpRight, BarChart3, ChevronLeft, ChevronRight, CircleUserRound, Clock3, LogOut, Plus, RefreshCw, Search, ShieldCheck, Trash2, X } from 'lucide-react'
import { supabase, updateWatchlist } from './lib/supabase'
import type { MarketFeedFilters, ScrapedItem, TickerSummary, TrackedStock } from './types'

const POLLING_MS = 300000
const PAGE_SIZE = 20
const dateFormatter = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
const dateTimeFormatter = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

type DataState = { stocks: TrackedStock[]; items: ScrapedItem[] }
type FinvizTestResult = { status: 'success' | 'error'; data: unknown; message: string | null; code: string | null }

function effectiveDate(item: ScrapedItem): number {
  return new Date(item.published_at ?? item.scraped_at).getTime()
}

function displayDate(value: string | null): string {
  return value ? dateTimeFormatter.format(new Date(value)) : 'Date unavailable'
}

function LoginView() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase) return
    setBusy(true)
    setError(null)
    const result = mode === 'sign-in'
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password })
    setBusy(false)
    if (result.error) setError(result.error.message)
  }

  return <main className="auth-shell">
    <section className="auth-panel">
      <div className="brand-mark"><BarChart3 size={20} strokeWidth={2.5} /></div>
      <p className="eyebrow">MARKET LEDGER</p>
      <h1>Keep your market view in focus.</h1>
      <p className="auth-copy">A private workspace for the signals, headlines, and conversations that matter to your watchlist.</p>
      <form onSubmit={submit} className="auth-form">
        <label>Email<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
        <label>Password<input type="password" autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'} value={password} onChange={(event) => setPassword(event.target.value)} minLength={6} required /></label>
        {error && <p className="form-error">{error}</p>}
        <button className="primary-button" disabled={busy}>{busy ? 'Connecting...' : mode === 'sign-in' ? 'Sign in' : 'Create account'}</button>
      </form>
      <button className="text-button" onClick={() => { setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in'); setError(null) }}>
        {mode === 'sign-in' ? 'Need an account? Create one' : 'Already have an account? Sign in'}
      </button>
    </section>
    <aside className="auth-aside"><ShieldCheck size={22} /><strong>Your workspace stays yours.</strong><span>Read access is authenticated through Supabase. Watchlist changes pass through the secured edge function.</span></aside>
  </main>
}

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [data, setData] = useState<DataState>({ stocks: [], items: [] })
  const [activeTicker, setActiveTicker] = useState<string | null>(null)
  const [filters, setFilters] = useState<MarketFeedFilters>({ source: 'all', period: 'all' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tickerInput, setTickerInput] = useState('')
  const [mutatingTicker, setMutatingTicker] = useState<string | null>(null)
  const [finvizTestBusy, setFinvizTestBusy] = useState(false)
  const [finvizTestResult, setFinvizTestResult] = useState<FinvizTestResult | null>(null)
  const refreshInFlight = useRef(false)

  useEffect(() => {
    if (!supabase) { setAuthLoading(false); return }
    void supabase.auth.getSession().then(({ data: authData }) => { setSession(authData.session); setAuthLoading(false) })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession))
    return () => listener.subscription.unsubscribe()
  }, [])

  const loadData = useCallback(async (silent = false) => {
    if (!supabase || !session || refreshInFlight.current) return
    refreshInFlight.current = true
    if (!silent) setLoading(true)
    setError(null)
    try {
      const [stocksResult, itemsResult] = await Promise.all([
        supabase.from('tracked_stocks').select('id, ticker, company_name, enabled, created_at').eq('enabled', true).order('ticker'),
        supabase.from('scraped_items').select('id, source_id, ticker, title, content, author, url, published_at, scraped_at, content_hash, metadata, created_at, item_type').order('published_at', { ascending: false, nullsFirst: false }).order('scraped_at', { ascending: false }),
      ])
      if (stocksResult.error) throw stocksResult.error
      if (itemsResult.error) throw itemsResult.error
      setData({ stocks: (stocksResult.data ?? []) as TrackedStock[], items: (itemsResult.data ?? []) as ScrapedItem[] })
      setActiveTicker((current) => current && stocksResult.data?.some((stock) => stock.ticker === current) ? current : stocksResult.data?.[0]?.ticker ?? null)
    } catch {
      setError('Unable to load market data.')
    } finally {
      refreshInFlight.current = false
      setLoading(false)
    }
  }, [session])

  useEffect(() => { if (session) void loadData() }, [session, loadData])
  useEffect(() => {
    if (!session) return
    const interval = window.setInterval(() => void loadData(true), POLLING_MS)
    return () => window.clearInterval(interval)
  }, [session, loadData])

  const summaries = useMemo(() => {
    const byTicker = new Map<string, TickerSummary>()
    data.stocks.forEach((stock) => byTicker.set(stock.ticker, { ticker: stock.ticker, totalNews: 0, totalPosts: 0, lastUpdated: null }))
    data.items.forEach((item) => {
      if (!item.ticker || !byTicker.has(item.ticker)) return
      const summary = byTicker.get(item.ticker)!
      if (item.item_type === 'news') summary.totalNews += 1
      if (item.item_type === 'post') summary.totalPosts += 1
      if (!summary.lastUpdated || effectiveDate(item) > new Date(summary.lastUpdated).getTime()) summary.lastUpdated = item.published_at ?? item.scraped_at
    })
    return byTicker
  }, [data])

  const filteredItems = useMemo(() => {
    if (!activeTicker) return []
    const now = Date.now()
    const periodMs: Record<MarketFeedFilters['period'], number> = { hour: 3600000, today: 86400000, 'three-days': 259200000, 'seven-days': 604800000, all: Number.POSITIVE_INFINITY }
    return [...new Map(data.items.filter((item) => {
      const sourceMatch = filters.source === 'all' || (filters.source === 'news' ? item.item_type === 'news' : item.item_type === 'post')
      return item.ticker === activeTicker && sourceMatch && now - effectiveDate(item) <= periodMs[filters.period]
    }).map((item) => [item.id, item])).values()].sort((a, b) => effectiveDate(b) - effectiveDate(a))
  }, [activeTicker, data.items, filters])

  const [page, setPage] = useState(1)
  useEffect(() => setPage(1), [activeTicker, filters])
  const pageItems = filteredItems.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const pageGroups = useMemo(() => {
    const groups = new Map<string, ScrapedItem[]>()
    pageItems.forEach((item) => { const key = dateFormatter.format(new Date(effectiveDate(item))); groups.set(key, [...(groups.get(key) ?? []), item]) })
    return [...groups]
  }, [pageItems])

  async function addTicker(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const ticker = tickerInput.trim().toUpperCase()
    if (!ticker || !session) return
    setMutatingTicker(ticker)
    setError(null)
    try {
      await updateWatchlist('enable', ticker, session.access_token)
      setTickerInput('')
      setActiveTicker(ticker)
      await loadData()
    } catch { setError('Unable to update watchlist.') } finally { setMutatingTicker(null) }
  }

  async function removeTicker(ticker: string) {
    if (!session) return
    setMutatingTicker(ticker)
    setError(null)
    try { await updateWatchlist('disable', ticker, session.access_token); await loadData() }
    catch { setError('Unable to update watchlist.') }
    finally { setMutatingTicker(null) }
  }

  if (authLoading) return <div className="center-state">Loading workspace...</div>
  if (!supabase) return <div className="center-state"><strong>Supabase configuration is missing.</strong><span>Add the public Vite environment variables to start the app.</span></div>
  if (!session) return <LoginView />
  const authenticatedSupabase = supabase

  async function testKuraFinviz() {
    setFinvizTestBusy(true)
    setFinvizTestResult(null)
    const { data: currentSession } = await authenticatedSupabase.auth.getSession()
    if (!currentSession.session) {
      setFinvizTestResult({ status: 'error', data: null, message: 'No authenticated session', code: 'SESSION_REQUIRED' })
      setFinvizTestBusy(false)
      return
    }

    try {
      const { data, error } = await authenticatedSupabase.functions.invoke('scrape-finviz', { body: { ticker: 'KURA' } })
      if (error) {
        const code = 'code' in error && typeof error.code === 'string' ? error.code : error.name || null
        setFinvizTestResult({ status: 'error', data, message: error.message, code })
      } else {
        setFinvizTestResult({ status: 'success', data, message: null, code: null })
      }
    } catch (testError) {
      setFinvizTestResult({ status: 'error', data: null, message: testError instanceof Error ? testError.message : 'Finviz test failed', code: null })
    } finally {
      setFinvizTestBusy(false)
    }
  }

  return <div className="app-shell">
    <header className="topbar"><div className="topbar-inner"><div className="wordmark"><span className="mini-mark"><BarChart3 size={16} /></span>Market Ledger</div><div className="user-menu"><CircleUserRound size={17} /><span>{session.user.email}</span><button className="test-button" onClick={() => void testKuraFinviz()} disabled={finvizTestBusy}>{finvizTestBusy ? 'Testing KURA...' : 'Test KURA Finviz'}</button><button title="Sign out" aria-label="Sign out" onClick={() => void authenticatedSupabase.auth.signOut()}><LogOut size={16} /></button></div></div></header>
    <main className="content">
      <section className="page-heading"><div><p className="eyebrow">PORTFOLIO INTELLIGENCE</p><h1>Watchlist</h1><p className="muted">A focused view of the latest market signals.</p></div><button className="quiet-button" onClick={() => void loadData()} disabled={loading}><RefreshCw size={16} className={loading ? 'spin' : ''} />{loading ? 'Refreshing' : 'Refresh'}</button></section>
      {finvizTestResult && <section className={`diagnostic-result ${finvizTestResult.status}`}><strong>{finvizTestResult.status === 'success' ? 'Success' : 'Error'}</strong>{finvizTestResult.message && <span>Message: {finvizTestResult.message}</span>}{finvizTestResult.code && <span>Code: {finvizTestResult.code}</span>}{finvizTestResult.data !== null && <pre>{JSON.stringify(finvizTestResult.data, null, 2)}</pre>}</section>}
      <section className="watchlist-section"><div className="section-topline"><h2>Tracked tickers</h2><span className="counter">{data.stocks.length} active</span></div><div className="ticker-row">{data.stocks.map((stock) => <div key={stock.id} className={`ticker-card ${activeTicker === stock.ticker ? 'selected' : ''}`} role="button" tabIndex={0} onClick={() => setActiveTicker(stock.ticker)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') setActiveTicker(stock.ticker) }}><button className="remove-ticker" title={`Remove ${stock.ticker}`} aria-label={`Remove ${stock.ticker}`} disabled={mutatingTicker !== null} onClick={(event) => { event.stopPropagation(); void removeTicker(stock.ticker) }}><Trash2 size={14} /></button><span className="ticker-symbol">{stock.ticker}</span><span className="ticker-name">{stock.company_name ?? 'Tracked security'}</span><span className="ticker-stats"><b>{summaries.get(stock.ticker)?.totalNews ?? 0}</b> news <b>{summaries.get(stock.ticker)?.totalPosts ?? 0}</b> posts</span><span className="ticker-updated">{summaries.get(stock.ticker)?.lastUpdated ? `Updated ${displayDate(summaries.get(stock.ticker)!.lastUpdated)}` : 'Awaiting first update'}</span><span className="card-accent" /></div>)}<form className="add-ticker" onSubmit={addTicker}><Search size={17} /><input placeholder="Add ticker" aria-label="Add ticker" value={tickerInput} onChange={(event) => setTickerInput(event.target.value)} /><button title="Add ticker" aria-label="Add ticker" disabled={!tickerInput.trim() || mutatingTicker !== null}><Plus size={18} /></button></form></div></section>
      {error && <div className="error-banner"><X size={17} />{error}</div>}
      <section className="feed-section"><div className="feed-header"><div><p className="eyebrow">MARKET FEED</p><h2>{activeTicker ?? 'Select a ticker'}</h2></div><div className="filters"><div className="segmented">{([['all', 'All'], ['news', 'News'], ['stocktwits', 'StockTwits']] as const).map(([value, label]) => <button key={value} className={filters.source === value ? 'active' : ''} onClick={() => setFilters({ ...filters, source: value })}>{label}</button>)}</div><select aria-label="Filter by time" value={filters.period} onChange={(event) => setFilters({ ...filters, period: event.target.value as MarketFeedFilters['period'] })}><option value="hour">Last hour</option><option value="today">Today</option><option value="three-days">3 days</option><option value="seven-days">7 days</option><option value="all">All time</option></select></div></div>
        {pageGroups.length === 0 ? <div className="empty-state"><Clock3 size={22} />{activeTicker && !data.items.some((item) => item.ticker === activeTicker) ? 'Waiting for first data update' : 'No items match these filters.'}</div> : <div className="feed-list">{pageGroups.map(([group, items]) => <div className="feed-group" key={group}><h3>{group}</h3>{items.map((item) => item.item_type === 'post' ? <article className="feed-item post-item" key={item.id}><div className="source-dot stocktwits-dot">S</div><div className="item-body"><div className="item-meta"><span>StockTwits</span><time>{displayDate(item.published_at ?? item.scraped_at)}</time></div><h3>{item.author ? `@${item.author}` : 'StockTwits post'}</h3><p>{item.content ?? 'No content available.'}</p></div></article> : <article className="feed-item" key={item.id}><div className="source-dot news-dot">N</div><div className="item-body"><div className="item-meta"><span>{typeof item.metadata.provider === 'string' ? item.metadata.provider : 'News'}</span><time>{displayDate(item.published_at ?? item.scraped_at)}</time></div><h3>{item.title ?? 'Untitled news item'}</h3><a href={item.url} target="_blank" rel="noreferrer">Read original <ArrowUpRight size={15} /></a></div></article>)}</div>)}</div>}
        {filteredItems.length > PAGE_SIZE && <div className="pagination"><span>Showing {(page - 1) * PAGE_SIZE + 1}-{Math.min(page * PAGE_SIZE, filteredItems.length)} of {filteredItems.length}</span><div><button title="Previous page" aria-label="Previous page" disabled={page === 1} onClick={() => setPage(page - 1)}><ChevronLeft size={17} /></button><button title="Next page" aria-label="Next page" disabled={page * PAGE_SIZE >= filteredItems.length} onClick={() => setPage(page + 1)}><ChevronRight size={17} /></button></div></div>}
      </section>
    </main>
  </div>
}

export default App
