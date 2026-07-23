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
  aiConfig: ['admin', 'ai-config'] as const,
  aiMetrics: (window: '7d' | '30d') => ['admin', 'ai-metrics', window] as const,
  draft: (id: string) => ['admin', 'draft', id] as const,
  feedback: (filters: { status?: string; category?: string; page: number; pageSize: number }) =>
    ['admin', 'feedback', filters] as const,
}
