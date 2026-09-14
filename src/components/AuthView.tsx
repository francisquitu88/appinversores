import { useState } from 'react'
import { supabase } from '../lib/supabase'

export function AuthView() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase) return
    setBusy(true)
    setError(null)
    const result = mode === 'sign-in'
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password })
    setBusy(false)
    if (result.error) setError(result.error.message)
  }

  return <main className="auth-shell">
    <section className="auth-panel auth-panel-simple">
      <p className="eyebrow">INVESTMENT RESEARCH</p>
      <h1>Welcome</h1>
      <form onSubmit={submit} className="auth-form">
        <label>Email<input className="auth-input" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
        <label>Password<input className="auth-input" type="password" autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'} value={password} onChange={(event) => setPassword(event.target.value)} minLength={6} required /></label>
        {error && <p className="form-error">Unable to authenticate.</p>}
        <button className="primary-button" disabled={busy}>{busy ? 'Connecting...' : mode === 'sign-in' ? 'Sign in' : 'Create account'}</button>
      </form>
      <button className="text-button" onClick={() => { setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in'); setError(null) }}>
        {mode === 'sign-in' ? 'Need an account? Create one' : 'Already have an account? Sign in'}
      </button>
    </section>
  </main>
}
