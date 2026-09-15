import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { AuthView } from './components/AuthView'
import { ApplicationShell } from './components/layout/ApplicationShell'
import { DashboardPage } from './pages/DashboardPage'
import { CompanyWorkspacePage } from './pages/CompanyWorkspacePage'
import { NotificationPreferences } from './components/NotificationPreferences'
import { supabase } from './lib/supabase'
import { I18nProvider } from './i18n/I18nProvider'

function routeFromLocation() {
  const pathname = window.location.pathname
  if (pathname === '/settings') {
    return { name: 'settings' as const, ticker: null }
  }
  const match = pathname.match(/^\/company\/([^/]+)\/?$/i)
  return match ? { name: 'company' as const, ticker: decodeURIComponent(match[1]).toUpperCase() } : { name: 'dashboard' as const, ticker: null }
}

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [route, setRoute] = useState(routeFromLocation)

  useEffect(() => {
    if (!supabase) { setAuthLoading(false); return }
    void supabase.auth.getSession().then(({ data }) => { setSession(data.session); setAuthLoading(false) })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession))
    const onPopState = () => setRoute(routeFromLocation())
    window.addEventListener('popstate', onPopState)
    return () => { listener.subscription.unsubscribe(); window.removeEventListener('popstate', onPopState) }
  }, [])

  function navigate(path: string) {
    window.history.pushState({}, '', path)
    setRoute(routeFromLocation())
  }

  if (authLoading) return <div className="center-state">Authenticating...</div>
  if (!supabase) return <div className="center-state"><strong>Supabase configuration is missing.</strong><span>Add the public Vite environment variables to start the app.</span></div>
  if (!session) return <AuthView />
  const authenticatedSupabase = supabase

  return <I18nProvider session={session} client={authenticatedSupabase}>
    <ApplicationShell session={session} onSignOut={() => void authenticatedSupabase.auth.signOut()} onNavigate={navigate}>
      {route.name === 'settings' ? (
        <div className="settings-page">
          <section className="page-heading simple-heading"><div><h1>Settings</h1></div></section>
          <NotificationPreferences />
        </div>
      ) : route.name === 'company' && route.ticker ? (
        <CompanyWorkspacePage ticker={route.ticker} onNavigate={navigate} />
      ) : (
        <DashboardPage session={session} onNavigate={navigate} />
      )}
    </ApplicationShell>
  </I18nProvider>
}

export default App
