import { ArrowUpRight, Clock3 } from 'lucide-react'
import type { FinvizAnalystRating, FinvizInsiderTrade, ScrapedItem } from '../../types'
import { useI18n } from '../../i18n/useI18n'

const dateFormatter = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' })
const calendarDateFormatter = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })

function isSec(item: ScrapedItem) { return item.metadata.source === 'SEC' || typeof item.metadata.accessionNumber === 'string' }
function itemDate(item: ScrapedItem) { return new Date(item.published_at ?? item.scraped_at).getTime() }
function calendarDateTimestamp(value: string) { const [year, month, day] = value.slice(0, 10).split('-').map(Number); return Date.UTC(year, month - 1, day, 12) }
function date(value: string | null) { return value ? calendarDateFormatter.format(new Date(calendarDateTimestamp(value))) : 'Date unavailable' }
function form(item: ScrapedItem) { return typeof item.metadata.form === 'string' ? item.metadata.form : 'SEC filing' }

type Activity = {
  key: string
  kind: 'NEWS' | 'SEC' | 'RATING' | 'INSIDER'
  date: number
  title: string
  meta: string
  url: string | null
}

export function IntelligenceView({ items, ratings, insiderTrades }: { items: ScrapedItem[]; ratings: FinvizAnalystRating[]; insiderTrades: FinvizInsiderTrade[] }) {
  const { t } = useI18n()
  const news = items.filter((item) => !isSec(item) && item.item_type !== 'post')
  const sec = items.filter(isSec)
  
  // Build combined activity feed
  const activity: Activity[] = [
    ...news.map((item) => ({ key: `news-${item.id}`, kind: 'NEWS' as const, date: itemDate(item), title: item.title ?? 'Untitled news', meta: typeof item.metadata.provider === 'string' ? item.metadata.provider : 'FINVIZ', url: item.url })),
    ...sec.map((item) => ({ key: `sec-${item.id}`, kind: 'SEC' as const, date: itemDate(item), title: item.title ?? `${form(item)} filing`, meta: form(item), url: item.url })),
    ...ratings.map((item) => ({ key: `rating-${item.id}`, kind: 'RATING' as const, date: calendarDateTimestamp(item.rating_date), title: `${item.action} - ${item.analyst}`, meta: item.rating_change || 'Analyst update', url: null })),
    ...insiderTrades.map((item) => ({ key: `insider-${item.id}`, kind: 'INSIDER' as const, date: calendarDateTimestamp(item.transaction_date), title: `${item.transaction} - ${item.insider_name}`, meta: item.relationship, url: item.sec_form4_url })),
  ].sort((a, b) => b.date - a.date)

  return <div className="intelligence-grid">
    <section className="intelligence-main">
      {/* Summary Section */}
      <div className="workspace-section-heading"><div><h2>Summary</h2></div></div>
      <div className="summary-stats">
        <div className="stat-item">
          <span className="stat-label">News</span>
          <span className="stat-value">{news.length}</span>
          {news.length > 0 && <span className="stat-date">Latest: {date(news[0]?.published_at ?? null)}</span>}
        </div>
        <div className="stat-item">
          <span className="stat-label">SEC Filings</span>
          <span className="stat-value">{sec.length}</span>
          {sec.length > 0 && <span className="stat-date">Latest: {date(sec[0]?.published_at ?? null)}</span>}
        </div>
        <div className="stat-item">
          <span className="stat-label">Analyst Ratings</span>
          <span className="stat-value">{ratings.length}</span>
          {ratings.length > 0 && <span className="stat-date">Latest: {date(ratings[0]?.rating_date ?? null)}</span>}
        </div>
        <div className="stat-item">
          <span className="stat-label">Insider Trades</span>
          <span className="stat-value">{insiderTrades.length}</span>
          {insiderTrades.length > 0 && <span className="stat-date">Latest: {date(insiderTrades[0]?.transaction_date ?? null)}</span>}
        </div>
      </div>

      {/* Recent Activity Section */}
      <div className="workspace-section-heading"><div><h2>{t('recentActivity')}</h2></div></div>
      {activity.length === 0 ? <EmptyState label={t('noDataAvailable')} /> : <div className="activity-list">{activity.slice(0, 20).map((event) => <article className="activity-row" key={event.key}><span className={`activity-kind ${event.kind.toLowerCase()}`}>{event.kind}</span><div><strong>{event.title}</strong><span>{event.meta}</span>{event.url && <a className="activity-source-link" href={event.url} target="_blank" rel="noreferrer">{t('openSource')} <ArrowUpRight size={13} /></a>}</div><time>{dateFormatter.format(new Date(event.date))}</time></article>)}</div>}
    </section>
    <section className="intelligence-panel"><div className="workspace-section-heading"><div><p className="eyebrow">FINVIZ</p><h2>{t('analystRatings')}</h2></div><span className="section-count">{ratings.length}</span></div>{ratings.length === 0 ? <EmptyState label={t('noDataAvailable')} /> : <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Date</th><th>Action</th><th>Analyst</th><th>Rating Change</th><th>Price Target</th></tr></thead><tbody>{ratings.map((rating) => <tr key={rating.id}><td>{date(rating.rating_date)}</td><td>{rating.action}</td><td>{rating.analyst}</td><td>{rating.rating_change || '-'}</td><td>{rating.price_target_change || '-'}</td></tr>)}</tbody></table></div>}</section>
    <section className="intelligence-panel"><div className="workspace-section-heading"><div><p className="eyebrow">FINVIZ</p><h2>{t('insiderTrading')}</h2></div><span className="section-count">{insiderTrades.length}</span></div>{insiderTrades.length === 0 ? <EmptyState label={t('noDataAvailable')} /> : <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Insider</th><th>Relationship</th><th>Date</th><th>Transaction</th><th>Cost</th><th>Shares</th><th>Value</th><th>Shares Total</th><th>{t('secForm4')}</th></tr></thead><tbody>{insiderTrades.map((trade) => <tr key={trade.id}><td>{trade.insider_name}</td><td>{trade.relationship}</td><td>{date(trade.transaction_date)}</td><td>{trade.transaction}</td><td>{trade.cost || '-'}</td><td>{trade.shares || '-'}</td><td>{trade.value || '-'}</td><td>{trade.shares_total || '-'}</td><td><a className="table-link" href={trade.sec_form4_url} target="_blank" rel="noreferrer" aria-label={`${t('secForm4')} ${trade.insider_name}`}><ArrowUpRight size={14} /></a></td></tr>)}</tbody></table></div>}</section>
  </div>
}

function EmptyState({ label }: { label: string }) { return <div className="workspace-empty"><Clock3 size={18} /><span>{label}</span></div> }
