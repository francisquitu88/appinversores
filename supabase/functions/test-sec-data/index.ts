import { errorResponse, handleOptions, ok, readJson } from '../_shared/response.ts'
import { requireAuthenticatedUser } from '../_shared/supabase.ts'

const SEC_TICKERS_URL = 'https://www.sec.gov/files/company_tickers.json'
const SEC_SUBMISSIONS_URL = 'https://data.sec.gov/submissions/CIK'
const SEC_USER_AGENT_ENV = 'SEC_USER_AGENT'

type TickerEntry = { cik_str?: number; ticker?: string; title?: string }
type RecentFilings = {
  form?: string[]
  filingDate?: string[]
  reportDate?: string[]
  accessionNumber?: string[]
  primaryDocument?: string[]
}
type Submissions = {
  name?: string
  filings?: { recent?: RecentFilings }
}

function getSecHeaders(): HeadersInit {
  const userAgent = Deno.env.get(SEC_USER_AGENT_ENV)?.trim()
  if (!userAgent) throw new Error('SEC_USER_AGENT_MISSING')
  return { 'User-Agent': userAgent, Accept: 'application/json' }
}

async function fetchJson<T>(url: string, headers: HeadersInit): Promise<T> {
  const response = await fetch(url, { headers })
  if (!response.ok) throw new Error(`SEC_HTTP_${response.status}`)
  return await response.json() as T
}

async function resolveTicker(ticker: string, headers: HeadersInit): Promise<{ cik: string; name: string }> {
  const directory = await fetchJson<Record<string, TickerEntry>>(SEC_TICKERS_URL, headers)
  const match = Object.values(directory).find((entry) => entry.ticker?.toUpperCase() === ticker)
  if (!match?.cik_str || !match.title) throw new Error('TICKER_NOT_FOUND')
  return { cik: String(match.cik_str).padStart(10, '0'), name: match.title }
}

function recentFilings(submissions: Submissions, cik: string): Array<Record<string, unknown>> {
  const recent = submissions.filings?.recent
  if (!recent) return []
  const rows = recent.form?.map((form, index) => ({
    form,
    filingDate: recent.filingDate?.[index],
    reportDate: recent.reportDate?.[index] ?? null,
    accessionNumber: recent.accessionNumber?.[index],
    primaryDocument: recent.primaryDocument?.[index],
  })) ?? []

  return rows.slice(0, 5).map((row) => ({
    ...row,
    url: `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${String(row.accessionNumber).replaceAll('-', '')}/${row.primaryDocument}`,
  }))
}

Deno.serve(async (request) => {
  const options = handleOptions(request)
  if (options) return options

  try {
    if (request.method !== 'POST') return errorResponse('METHOD_NOT_ALLOWED', 'Use POST', 405, request)
    await requireAuthenticatedUser(request)
    const body = await readJson(request)
    const ticker = typeof body?.ticker === 'string' ? body.ticker.trim().toUpperCase() : ''
    if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(ticker)) return errorResponse('INVALID_TICKER', 'ticker must be a valid symbol', 400, request)

    const headers = getSecHeaders()
    const company = await resolveTicker(ticker, headers)
    const submissions = await fetchJson<Submissions>(`${SEC_SUBMISSIONS_URL}${company.cik}.json`, headers)

    return ok({ ticker, cik: company.cik, companyName: submissions.name ?? company.name, filings: recentFilings(submissions, company.cik) }, request)
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message === 'AUTHORIZATION_REQUIRED' || message === 'INVALID_ACCESS_TOKEN') return errorResponse('UNAUTHORIZED', 'A valid Supabase access token is required', 401, request)
    if (message === 'BACKEND_CONFIG_MISSING') return errorResponse('BACKEND_CONFIG_MISSING', 'Supabase backend configuration is missing', 500, request)
    if (message === 'SEC_USER_AGENT_MISSING') return errorResponse('SEC_CONFIG_MISSING', 'SEC_USER_AGENT is not configured', 500, request)
    if (message === 'TICKER_NOT_FOUND') return errorResponse('TICKER_NOT_FOUND', 'Ticker was not found in the SEC directory', 404, request)
    return errorResponse('SEC_REQUEST_FAILED', 'SEC request failed', 502, request)
  }
})