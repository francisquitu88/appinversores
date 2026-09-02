export async function generateContentHash(input: { source: string; ticker: string | null; title: string | null; content: string | null; url: string }): Promise<string> {
  const normalize = (value: string | null) => (value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()
  const canonicalUrl = (() => {
    try {
      const url = new URL(input.url)
      for (const key of [...url.searchParams.keys()]) if (/^(utm_|ref$|source$|campaign$|mc_)/i.test(key)) url.searchParams.delete(key)
      url.hash = ''
      return url.toString().replace(/\/$/, '')
    } catch { return input.url }
  })()
  const canonical = [input.source, input.ticker, input.title, input.content, canonicalUrl].map(normalize).join('|')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
