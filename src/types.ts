export type TrackedStock = {
  id: string
  ticker: string
  company_name: string | null
  enabled: boolean
  created_at: string
}

export type ScrapedItem = {
  id: string
  source_id: string
  ticker: string | null
  title: string | null
  content: string | null
  author: string | null
  url: string
  published_at: string | null
  scraped_at: string
  content_hash: string
  metadata: Record<string, unknown>
  created_at: string
  item_type: 'news' | 'post' | string
}

export type MarketFeedFilters = {
  source: 'all' | 'news' | 'stocktwits'
  period: 'hour' | 'today' | 'three-days' | 'seven-days' | 'all'
}

export type TickerSummary = {
  ticker: string
  totalNews: number
  totalPosts: number
  lastUpdated: string | null
}
