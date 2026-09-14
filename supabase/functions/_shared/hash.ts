export async function generateContentHash(input: { source: string; ticker: string | null; title: string | null; content: string | null; url: string; articleIdentity?: string | null }): Promise<string> {
  const normalize = (value: string | null) => (value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()
  const canonicalUrl = (() => {
    try {
      const url = new URL(input.url)
      for (const key of [...url.searchParams.keys()]) if (/^(utm_|ref$|source$|campaign$|mc_)/i.test(key)) url.searchParams.delete(key)
      url.hash = ''
      return url.toString().replace(/\/$/, '')
    } catch { return input.url }
  })()
  const identity = normalize(input.articleIdentity ?? canonicalUrl)
  const canonical = [input.source, input.ticker, input.title, input.content, identity].map(normalize).join('|')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function generateIdentityHash(source: string, values: Array<string | null | undefined>): Promise<string> {
  const normalize = (value: string | null | undefined) => (value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()
  const canonical = [source, ...values].map(normalize).join('|')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
