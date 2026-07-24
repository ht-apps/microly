import { QueryClient } from '@tanstack/react-query'

import { ApiError } from './api'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => !(error instanceof ApiError && error.status < 500) && failureCount < 1,
    },
    mutations: { retry: false },
  },
})

export const queryKeys = {
  metrics: (window: '7d' | '30d') => ['admin', 'metrics', window] as const,
  content: ['admin', 'content'] as const,
  release: (version: number) => ['admin', 'release', version] as const,
  aiConfig: ['admin', 'ai-config'] as const,
  aiMetrics: (window: '7d' | '30d') => ['admin', 'ai-metrics', window] as const,
  operations: (window: '1h' | '24h' | '7d') => ['admin', 'operations', window] as const,
  draft: (id: string) => ['admin', 'draft', id] as const,
  generationJobs: (draftId: string) => ['admin', 'content-generation-jobs', draftId] as const,
  contentReviews: (draftId: string) => ['admin', 'content-reviews', draftId] as const,
  contentReadiness: (draftId: string) => ['admin', 'content-readiness', draftId] as const,
  feedback: (filters: { status?: string; category?: string; page: number; pageSize: number }) =>
    ['admin', 'feedback', filters] as const,
}
