import { lazy, type ReactNode, Suspense } from 'react'
import { BrowserRouter, Link, Route, Routes } from 'react-router'
import type { SemanticStore } from 'semantic-state'
import { SemanticProvider } from 'semantic-state/react'
import { LIBRECHAT_URL } from './config'
import { DetailPage } from './pages/DetailPage'
import { ListPage } from './pages/ListPage'
import { NotFound } from './pages/NotFound'
import type { ChartSummary } from './types'

// json-render ships only with the dashboard route, so the list and detail pages do not pay for it.
const DashboardPage = lazy(() => import('./pages/DashboardPage'))

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<ListPage />} />
      <Route path="/charts/:id" element={<DetailPage />} />
      <Route
        path="/dashboard"
        element={
          <Suspense fallback={<p className="status">Loading dashboard…</p>}>
            <DashboardPage />
          </Suspense>
        }
      />
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}

function Layout({ children }: { readonly children: ReactNode }) {
  return (
    <>
      <header className="topbar">
        <Link to="/" className="brand">
          Chart Gallery
        </Link>
        <a href={LIBRECHAT_URL}>LibreChat</a>
      </header>
      <main className="content">{children}</main>
    </>
  )
}

export function App({ store }: { readonly store: SemanticStore<ChartSummary> }) {
  return (
    <SemanticProvider store={store}>
      <BrowserRouter>
        <Layout>
          <AppRoutes />
        </Layout>
      </BrowserRouter>
    </SemanticProvider>
  )
}
