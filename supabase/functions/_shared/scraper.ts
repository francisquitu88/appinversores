import type { ScrapedItemType } from '../../../src/types/index.ts'

export interface ScraperInput { ticker: string }
export interface ScrapedItemDraft { source_id: string; ticker: string | null; item_type: ScrapedItemType; title: string | null; content: string | null; author: string | null; url: string; published_at: string | null; scraped_at: string; content_hash: string; metadata: Record<string, unknown> }
export interface Scraper { source: string; scrape(input: ScraperInput): Promise<ScrapedItemDraft[]> }
export function normalizeTicker(value: unknown): string | null { if (typeof value !== 'string') return null; const ticker = value.trim().toUpperCase(); return /^[A-Z][A-Z0-9.-]{0,9}$/.test(ticker) ? ticker : null }
