export type TrackedStock = {
  id: string
  ticker: string
  company_name: string | null
  enabled: boolean
  created_at: string
}

export type ScrapedItemType = 'news' | 'post' | string

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
  item_type: ScrapedItemType
}

export type FinvizAnalystRating = {
  id: string
  ticker: string
  source_id: string
  rating_date: string
  action: string
  analyst: string
  rating_change: string
  price_target_change: string
  created_at: string
  scraped_at: string
  content_hash: string
}

export type FinvizInsiderTrade = {
  id: string
  ticker: string
  source_id: string
  insider_name: string
  relationship: string
  transaction_date: string
  transaction: string
  cost: string
  shares: string
  value: string
  shares_total: string
  sec_form4_url: string
  form4_display_timestamp?: string | null
  created_at: string
  scraped_at: string
  content_hash: string
}

export type MarketFeedFilters = {
  source: 'all' | 'news' | 'sec'
  period: 'hour' | 'today' | 'three-days' | 'seven-days' | 'all'
}

export type TickerSummary = {
  ticker: string
  totalNews: number
  totalFilings: number
  totalRatings: number
  totalInsiders: number
  latestNews: string | null
  latestFiling: string | null
  latestRating: string | null
  latestInsider: string | null
}

export type NotificationPreferences = {
  id: string
  user_id: string
  email_enabled: boolean
  news_enabled: boolean
  sec_enabled: boolean
  ratings_enabled: boolean
  insider_trades_enabled: boolean
  email: string
  created_at: string
  updated_at: string
}

export type NotificationSentLog = {
  id: string
  user_id: string
  ticker: string
  event_type: 'news' | 'sec' | 'rating' | 'insider'
  event_id: string
  recipient_email: string
  subject: string
  status: 'pending' | 'sending' | 'sent' | 'failed'
  attempts: number
  sent_at: string | null
  error_message: string | null
  created_at: string
}

export type EventNotificationPayload = {
  user_id: string
  ticker: string
  event_type: 'news' | 'sec' | 'rating' | 'insider'
  event_id: string
  recipient_email: string
  subject: string
  title: string
  content?: string | null
  url?: string | null
  source?: string
  published_at?: string | null
}
