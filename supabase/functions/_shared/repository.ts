import type { ScrapedItemDraft } from './scraper.ts'
import { createBackendClient } from './supabase.ts'

export async function resolveSourceId(slug: string): Promise<string> { const { data, error } = await createBackendClient().from('sources').select('id').eq('slug', slug).eq('enabled', true).maybeSingle(); if (error) throw new Error(`Could not resolve source: ${error.message}`); if (!data) throw new Error(`Source '${slug}' was not found or is disabled`); return data.id }
export async function assertTrackedTicker(ticker: string): Promise<void> { const { data, error } = await createBackendClient().from('tracked_stocks').select('ticker').eq('ticker', ticker).eq('enabled', true).maybeSingle(); if (error) throw new Error(`Could not resolve ticker: ${error.message}`); if (!data) throw new Error('TICKER_NOT_TRACKED') }
export async function saveScrapedItem(item: ScrapedItemDraft): Promise<'new' | 'duplicate'> { const { error } = await createBackendClient().from('scraped_items').insert(item); if (!error) return 'new'; if (error.code === '23505') return 'duplicate'; throw new Error(`Could not save scraped item: ${error.message}`) }

export async function saveFinvizScrapedItem(item: ScrapedItemDraft): Promise<'new' | 'duplicate' | 'updated'> {
	const client = createBackendClient()
	const { error: insertError } = await client.from('scraped_items').insert(item)
	if (!insertError) return 'new'
	if (insertError.code !== '23505') throw new Error(`Could not save scraped item: ${insertError.message}`)

	const findExisting = async (column: 'content_hash' | 'url', value: string) => client
		.from('scraped_items')
		.select('id, title, published_at, metadata')
		.eq('source_id', item.source_id)
		.eq('ticker', item.ticker)
		.eq(column, value)
		.limit(1)
		.maybeSingle()

	let lookup = await findExisting('content_hash', item.content_hash)
	if (!lookup.data && !lookup.error) lookup = await findExisting('url', item.url)
	if (lookup.error) throw new Error(`Could not resolve duplicate scraped item: ${lookup.error.message}`)
	if (!lookup.data || item.published_at === null || lookup.data.published_at !== null) return 'duplicate'

	const existingMetadata = lookup.data.metadata && typeof lookup.data.metadata === 'object' && !Array.isArray(lookup.data.metadata)
		? lookup.data.metadata as Record<string, unknown>
		: {}
	const newRawTimestamp = typeof item.metadata.raw_timestamp === 'string' ? item.metadata.raw_timestamp : null
	const newProvider = typeof item.metadata.provider === 'string' ? item.metadata.provider.trim() : ''
	const existingProvider = typeof existingMetadata.provider === 'string' ? existingMetadata.provider.trim() : ''
	const legacyProvider = newProvider.length > 0 && (
		existingProvider === `${lookup.data.title ?? ''} (${newProvider})` ||
		existingProvider.endsWith(`(${newProvider})`)
	)
	const metadata = {
		...existingMetadata,
		...(newRawTimestamp ? { raw_timestamp: newRawTimestamp } : {}),
		...(newProvider && (!existingProvider || legacyProvider) ? { provider: newProvider } : {}),
	}

	const { error: updateError } = await client
		.from('scraped_items')
		.update({ published_at: item.published_at, metadata })
		.eq('id', lookup.data.id)
		.is('published_at', null)

	if (updateError) throw new Error(`Could not update duplicate scraped item: ${updateError.message}`)
	return 'updated'
}
