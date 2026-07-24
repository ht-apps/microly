/* oxlint-disable react/only-export-components */
import { lazy, Suspense, type ReactNode } from 'react'
import { Navigate, createHashRouter, useLocation } from 'react-router'

import { useAuth } from './auth'
import { PageLoading } from './components/PageState'
import { AdminLayout } from './layout/AdminLayout'
import { LoginPage } from './pages/LoginPage'

const DashboardPage = lazy(() => import('./pages/DashboardPage'))
const ContentPage = lazy(() => import('./pages/ContentPage'))
const FeedbackPage = lazy(() => import('./pages/FeedbackPage'))
const AiPage = lazy(() => import('./pages/AiPage'))
const OperationsPage = lazy(() => import('./pages/OperationsPage'))

function Protected({ children }: { children: ReactNode }) {
  const { token } = useAuth()
  const location = useLocation()
  return token ? children : <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />
}

function RouteFallback({ children }: { children: ReactNode }) {
  return <Suspense fallback={<PageLoading rows={8} />}>{children}</Suspense>
}

export const router = createHashRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: <Protected><AdminLayout /></Protected>,
    children: [
      { path: '/dashboard', element: <RouteFallback><DashboardPage /></RouteFallback> },
      { path: '/content', element: <RouteFallback><ContentPage /></RouteFallback> },
      { path: '/content/drafts/:draftId', element: <RouteFallback><ContentPage /></RouteFallback> },
      { path: '/feedback', element: <RouteFallback><FeedbackPage /></RouteFallback> },
      { path: '/ai', element: <RouteFallback><AiPage /></RouteFallback> },
      { path: '/operations', element: <RouteFallback><OperationsPage /></RouteFallback> },
    ],
  },
  { path: '*', element: <Navigate to="/dashboard" replace /> },
])
