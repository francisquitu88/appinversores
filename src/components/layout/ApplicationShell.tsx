import type { ReactNode } from 'react'
import { CircleUserRound, LogOut } from 'lucide-react'
import type { Session } from '@supabase/supabase-js'

export function ApplicationShell({ session, onSignOut, children }: { session: Session; onSignOut: () => void; onNavigate: (path: string) => void; children: ReactNode }) {
  return <div className="app-shell clean-shell">
    <header className="topbar clean-topbar"><div className="topbar-inner"><span className="wordmark">Investment Research</span><div className="user-menu"><CircleUserRound size={17} /><span>{session.user.email}</span><button title="Sign out" aria-label="Sign out" onClick={onSignOut}><LogOut size={16} /></button></div></div></header>
    <main className="content workspace-content clean-content">{children}</main>
  </div>
}
