import { QueryClientProvider } from '@tanstack/react-query'
import { App as AntApp, ConfigProvider } from 'antd'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import App from './App'
import { AuthProvider } from './auth'
import { queryClient } from './query-client'
import { router } from './router'

function renderApp() {
  return render(<ConfigProvider><AntApp><QueryClientProvider client={queryClient}><AuthProvider><App /></AuthProvider></QueryClientProvider></AntApp></ConfigProvider>)
}

beforeEach(() => {
  sessionStorage.clear()
  queryClient.clear()
  window.location.hash = '#/dashboard'
})

describe('admin routes and session', () => {
  it('未登录访问受保护页面时进入登录页', async () => {
    renderApp()
    expect(await screen.findByRole('heading', { name: '进入运营后台' })).toBeTruthy()
    expect(window.location.hash).toContain('/login')
  })

  it('验证令牌后返回目标页面', async () => {
    const token = 'admin-token-with-at-least-32-characters'
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/v1/admin/session')) return new Response(JSON.stringify({ data: { authenticated: true } }))
      return new Response(JSON.stringify({ data: {
        window: '7d', generatedAt: '2026-07-23T10:00:00.000Z',
        funnel: ['app_open', 'onboarding_view', 'training_start', 'option_select', 'training_complete', 'wechat_login_success'].map((name, index) => ({ name, accounts: 6 - index, conversionRate: index ? 0.8 : null })),
        daily: [], sessions: [],
        feedback: { total: 0, byStatus: { new: 0, in_progress: 0, resolved: 0, dismissed: 0 }, byCategory: {} },
      } }))
    }))
    const user = userEvent.setup()
    renderApp()
    const input = await screen.findByPlaceholderText('输入 ADMIN_API_TOKEN')
    await user.click(input)
    await user.type(input, token)
    await user.click(screen.getByRole('button', { name: '验证并进入' }))
    expect(await screen.findByRole('heading', { name: '学习漏斗' })).toBeTruthy()
    expect(sessionStorage.getItem('microly:admin-token')).toBe(token)
  })

  it('登录后返回最初请求的受保护页面', async () => {
    window.location.hash = '#/content'
    await router.navigate('/content')
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/v1/admin/session')) return new Response(JSON.stringify({ data: { authenticated: true } }))
      return new Response(JSON.stringify({ data: { currentVersion: 1, releases: [], drafts: [] } }))
    }))
    const user = userEvent.setup()
    renderApp()
    const input = await screen.findByPlaceholderText('输入 ADMIN_API_TOKEN')
    await user.click(input)
    await user.type(input, 'admin-token-with-at-least-32-characters')
    await user.click(screen.getByRole('button', { name: '验证并进入' }))
    expect(await screen.findByRole('heading', { name: '版本与草稿' })).toBeTruthy()
    expect(window.location.hash).toContain('/content')
  })

  it('学习质量页面从 URL 读取窗口并展示样本未成熟状态', async () => {
    const token = 'admin-token-with-at-least-32-characters'
    sessionStorage.setItem('microly:admin-token', token)
    await router.navigate('/learning-quality?window=30d')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: {
      window: '30d', generatedAt: '2026-07-24T10:00:00.000Z', coverageStartedAt: null,
      selectedReleaseVersion: 2, currentReleaseVersion: 2,
      filters: { releases: [{ releaseVersion: 2, publishedAt: '2026-07-24T09:00:00.000Z' }], catalogs: [], sessions: [] },
      summary: {
        firstOpenAccounts: 0, firstTrainingStartedAccounts: 0, firstTrainingStartRate: null,
        firstTrainingCompletedAccounts: 0, firstTrainingCompletionRate: null,
        d1EligibleAccounts: 0, d1RetainedAccounts: 0, d1RetentionRate: null,
        sevenDayEligibleAccounts: 0, sevenDayThreePracticeAccounts: 0, sevenDayThreePracticeRate: null,
        completedAttempts: 0, activePracticeRate: null, medianDurationMs: null,
        dueReviewOccurrences: 0, dueReviewCompleted: 0, dueReviewCompletionRate: null,
        welAccounts: 0, openIssueCount: 0,
      },
      retentionTrend: [], sessions: [], issues: [],
    } }))))

    renderApp()
    expect(await screen.findByRole('heading', { name: '学习质量' })).toBeTruthy()
    expect(screen.getByText('近 30 天')).toBeTruthy()
    expect(await screen.findByText('当前筛选范围没有新版训练数据')).toBeTruthy()
    expect(window.location.hash).toContain('window=30d')
  })
})
