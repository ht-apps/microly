import { useMemo, useState } from 'react'
import { Button, ScrollView, Text, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'

import { getFirstAvailableTraining, getTrainingSession, trainingContent } from '../../data/training-content'
import { readLearningActivitySnapshot } from '../../features/activity/activity-snapshot'
import { flushAnalyticsOutbox, trackEvent } from '../../features/analytics/analytics-client'
import { trackTrainingStart } from '../../features/analytics/training-analytics'
import { readTrainingProgress, writeTrainingProgress } from '../../features/training/training-storage'
import { transitionTraining } from '../../features/training/training-state'
import { canUseAi, listAiEvaluations } from '../../features/ai/ai-client'
import { readCachedAiEvaluations } from '../../features/ai/ai-history-storage'
import { buildWeeklyReport, weekStartForOffset } from '../../features/report/weekly-report'
import { readReviewSnapshot } from '../../features/review/review-snapshot'

import './index.scss'

function formatWeek(start: string, end: string, offset: number) {
  if (offset === 0) return '本周'
  const [, startMonth, startDay] = start.split('-')
  const [, endMonth, endDay] = end.split('-')
  return `${Number(startMonth)}/${Number(startDay)}–${Number(endMonth)}/${Number(endDay)}`
}

export default function WeeklyReportPage() {
  const [weekOffset, setWeekOffset] = useState(0)
  const [events, setEvents] = useState(() => readLearningActivitySnapshot().events)
  const [evaluations, setEvaluations] = useState(readCachedAiEvaluations)
  const reviews = readReviewSnapshot()
  const nextSession = getFirstAvailableTraining()

  useDidShow(() => {
    setEvents(readLearningActivitySnapshot().events)
    setEvaluations(readCachedAiEvaluations())
    trackEvent('weekly_report_view', { weekOffset })
    void flushAnalyticsOutbox()
    if (canUseAi()) void listAiEvaluations().then(setEvaluations)
  })

  const weeks = useMemo(() => Array.from({ length: 8 }, (_, offset) => {
    const weekStart = weekStartForOffset(offset)
    const report = buildWeeklyReport({
      weekStart, events, evaluations, sessions: trainingContent.sessions,
      dueReviewCount: offset === 0 ? reviews.overview.dueItems.length : 0,
      nextSessionId: nextSession?.sessionId,
    })
    return { offset, report }
  }), [events, evaluations, reviews.overview.dueItems.length, nextSession?.sessionId])
  const report = weeks[weekOffset].report
  const hasData = report.trainingCount > 0 || report.reviewCount > 0
  const skillTitle = trainingContent.chapters.find((chapter) => chapter.catalog?.skill === report.topSkill)?.catalog?.title ?? report.topSkill

  const selectWeek = (offset: number) => {
    setWeekOffset(offset)
    trackEvent('weekly_report_view', { weekOffset: offset })
    void flushAnalyticsOutbox()
  }
  const followAction = () => {
    const action = report.nextAction
    if (!action) return
    trackEvent('weekly_report_action', { weekOffset, action: action.type })
    void flushAnalyticsOutbox()
    if (action.type === 'review') void Taro.navigateTo({ url: '/pages/review/index' })
    else {
      const session = getTrainingSession(action.sessionId ?? '')
      if (!session) return
      const stored = readTrainingProgress(session)
      const started = transitionTraining(stored.progress, session, { type: 'START' })
      writeTrainingProgress(started)
      trackTrainingStart(session, started, 'weekly_report')
      void Taro.navigateTo({ url: `/pages/training/index?sessionId=${encodeURIComponent(session.sessionId)}&entry=weekly_report` })
    }
  }

  return <View className='weekly-report-page'>
    <View className='weekly-report-hero'>
      <Text className='weekly-report-eyebrow'>学习反馈</Text>
      <Text className='weekly-report-title'>看见这一周的练习积累</Text>
      <Text className='weekly-report-body'>只根据训练、到期复习和结构化点评生成，不评价真实能力。</Text>
    </View>
    <ScrollView scrollX className='weekly-report-weeks'>
      <View className='weekly-report-weeks__inner'>{weeks.map(({ offset, report: item }) => <Button key={item.weekStart} className={`microly-button weekly-report-week ${offset === weekOffset ? 'weekly-report-week--active' : ''}`} onClick={() => selectWeek(offset)}>{formatWeek(item.weekStart, item.weekEnd, offset)}</Button>)}</View>
    </ScrollView>
    {!hasData ? <View className='weekly-report-empty'>
      <Text className='weekly-report-empty__title'>这一周还没有学习记录</Text>
      <Text className='weekly-report-empty__body'>完成一组训练或两道到期复习后，这里会形成可解释的反馈。</Text>
    </View> : <>
      <View className='weekly-report-stats'>
        <View className='weekly-report-stat'><Text className='weekly-report-stat__value'>{report.effectiveDays}</Text><Text>有效学习日</Text></View>
        <View className='weekly-report-stat'><Text className='weekly-report-stat__value'>{report.trainingCount}</Text><Text>完成训练</Text></View>
        <View className='weekly-report-stat'><Text className='weekly-report-stat__value'>{report.reviewCount}</Text><Text>到期复习</Text></View>
      </View>
      <View className='weekly-report-card'>
        <Text className='weekly-report-card__label'>本周投入</Text>
        <Text className='weekly-report-card__title'>{skillTitle ? `主要练习了“${skillTitle}”` : `覆盖了 ${report.coveredSessionCount} 组训练`}</Text>
        <Text className='weekly-report-card__body'>共覆盖 {report.coveredSessionCount} 组不同训练{report.reviewCorrectRate === null ? '；暂无足够的复习正确率样本。' : `；到期复习中 ${Math.round(report.reviewCorrectRate * 100)}% 选择了更推荐的表达。`}</Text>
      </View>
      {(report.stableDimension || report.focusDimension) && <View className='weekly-report-card'>
        <Text className='weekly-report-card__label'>结构化点评观察</Text>
        {report.stableDimension && <Text className='weekly-report-card__body'>较稳定：{report.stableDimension}</Text>}
        {report.focusDimension && <Text className='weekly-report-card__body'>建议继续练习：{report.focusDimension}</Text>}
      </View>}
      {report.nextAction && <View className='weekly-report-action'>
        <Text className='weekly-report-card__label'>下一步建议</Text>
        <Text className='weekly-report-card__title'>{report.nextAction.label}</Text>
        <Button className='microly-button weekly-report-primary' onClick={followAction}>{report.nextAction.type === 'review' ? '去复习' : '继续训练'}</Button>
      </View>}
    </>}
  </View>
}
