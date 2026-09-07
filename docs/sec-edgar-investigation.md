# SEC/EDGAR investigation

These functions are isolated experiments. They do not write to Supabase and are not used by the production scrapers:

- `test-sec-data`: direct server-side fetch to SEC.
- `test-sec-api`: server-side fetch to SEC-API.io Query API.

## Direct SEC access

`data.sec.gov` requires no API key and exposes:

- `submissions/CIK##########.json`: company name and recent filing metadata, with older history files when needed.
- `api/xbrl/companyfacts/CIK##########.json`: all standard XBRL facts for the filer.
- `api/xbrl/companyconcept/...`: one taxonomy concept, and `api/xbrl/frames/...`: cross-company period frames.
- Filing documents under `https://www.sec.gov/Archives/edgar/data/{cik}/{accession-without-dashes}/...`.

Resolve ticker to CIK with `https://www.sec.gov/files/company_tickers.json`; it is a periodically updated lookup and should be refreshed or cached server-side. EDGAR RSS feeds are useful for latest-filing polling, but submissions plus a stored last accession are simpler per-company state.

SEC access is server-side only because `data.sec.gov` does not support CORS. Every request must send a declared `SEC_USER_AGENT` containing an application name and contact. The current published limit is 10 requests/second per IP; use caching, bounded concurrency, backoff on 429/403, and avoid polling more often than needed.

## SEC-API.io comparison

The Node SDK (`sec-api`, currently 4.x in the referenced repository) wraps the HTTP APIs. The Query API searches historical EDGAR filing metadata; Full-Text Search scans filing bodies and exhibits; Download retrieves filing or exhibit content; the Stream API delivers new filings over WebSocket. XBRL-to-JSON/financial statements and the 10-K/10-Q/8-K extractor remove parsing work. Dedicated APIs provide Form 3/4/5 insider transactions and 13F cover pages/holdings.

The recommended first integration is Query API for historical backfill and a scheduled polling cursor, or Stream API when near-real-time alerts justify a persistent worker. Add Full-Text, XBRL, extractor, insider and 13F services only for features that need normalized content or transactions. Keep both API keys backend-only; use the `Authorization` header rather than a URL token.

## Practical recommendation

Direct SEC fetch is the better low-cost source for ticker/CIK resolution, recent filings, filing links, and standard XBRL facts. SEC-API.io is better for historical search, full-text/exhibit search, parsed XBRL, sections, normalized Form 4 data, 13F holdings, and real-time delivery.

New `8-K`, `10-Q`, `10-K`, and Form 4 filings can be detected by polling submissions/Query API and deduplicating on accession number, or by filtering the Stream API. A scheduled worker every 5-15 minutes is reasonable for ordinary monitoring; use Stream for alerts where seconds matter. SEC direct polling should remain comfortably below 10 requests/second and should be cached per CIK. SEC-API.io limits depend on the subscription; its documented Query API page size is 50, full-text page size is 100, and both searches cap a query at 10,000 results.

For a small watchlist, use the SEC submissions feed as the source of truth. Cache the official ticker directory and the ticker-to-CIK mapping for at least a day, then poll one submissions JSON per CIK on a cursor interval. Compare the newest accession number and filing date with the last processed cursor; only map new rows into drafts. For 3 tickers, 15-30 minute polling is conservative; for 10 tickers, 15-30 minutes remains reasonable; for 50 tickers, use 30-60 minutes, stagger requests, cache responses, and consider a daily bulk refresh plus a shorter window for the most important names. EDGAR RSS/latest-filings feeds can reduce latency for market-wide discovery, but they are not a better per-company replacement for submissions and do not remove the need to resolve the filing to a CIK.

`accessionNumber` is the stable primary filing identifier and should be the first deduplication key. An amended filing has its own accession number and should normally be retained as a new submission, with `isAmendment` and `baseForm` recorded so consumers can group or supersede it intentionally. Do not deduplicate amendments merely by stripping `/A` from `form`.

For the existing schema, metadata-only filing records can be represented as `item_type='news'` with the filing URL, but that is a semantic compromise. A dedicated filing type/table is preferable if forms, accession numbers, XBRL facts, or insider transactions need distinct filtering. This experiment intentionally does not write to `scraped_items`.