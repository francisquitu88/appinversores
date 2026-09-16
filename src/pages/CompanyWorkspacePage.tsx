import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, RefreshCw } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { getCompanyData, type CompanyData } from '../lib/queries/company'
import { IntelligenceView } from '../components/intelligence/IntelligenceView'
import { useI18n } from '../i18n/useI18n'

function calendarDateTimestamp(value: string) { const [year, month, day] = value.slice(0, 10).split('-').map(Number); return Date.UTC(year, month - 1, day, 12) }
function lastUpdated(data: CompanyData) { const dates = [...data.items.map((item) => new Date(item.published_at ?? item.scraped_at).getTime()), ...data.ratings.map((item) => calendarDateTimestamp(item.rating_date)), ...data.insiderTrades.map((item) => calendarDateTimestamp(item.transaction_date))]; const value = Math.max(...dates, 0); return value ? new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'America/New_York' }).format(new Date(value)) : 'No data' }

export function CompanyWorkspacePage({ ticker, onNavigate }: { ticker: string; onNavigate: (path: string) => void }) {
  const { t } = useI18n()
  const [data, setData] = useState<CompanyData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const load = useCallback(async () => { if (!supabase) return; setLoading(true); setError(false); try { setData(await getCompanyData(supabase, ticker)) } catch { setError(true) } finally { setLoading(false) } }, [ticker])
  useEffect(() => { void load() }, [load])

  const stockName = data?.stock?.company_name ?? 'Tracked security'

  return <>
    <div className="company-header"><button className="back-link" onClick={() => onNavigate('/')}><ArrowLeft size={16} />{t('back')}</button><div className="company-title"><p className="eyebrow">{t('companyWorkspace')}</p><h1>{ticker}</h1><span>{stockName}</span></div><div className="company-actions"><span>{t('lastUpdated')}: {data ? lastUpdated(data) : t('loading')}</span><button className="quiet-button" onClick={() => void load()} disabled={loading}><RefreshCw size={15} className={loading ? 'spin' : ''} /></button></div></div>
    <div className="workspace-section-heading company-intelligence-heading"><div><h2>{t('intelligence')}</h2></div></div>
    {loading && <div className="workspace-empty">{t('loading')}</div>}
    {!loading && error && <div className="error-banner">{t('unableToLoadData')}</div>}
    {!loading && !error && !data?.stock && <div className="workspace-empty">{t('notActive')}</div>}
    {!loading && !error && data?.stock && <IntelligenceView items={data.items} ratings={data.ratings} insiderTrades={data.insiderTrades} />}
  </>
}

