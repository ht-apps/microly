import { Line } from '@ant-design/plots'
import type { AdminLearningQuality } from '@microly/api-contract'

export default function LearningRetentionChart({ data: source }: { data: AdminLearningQuality['retentionTrend'] }) {
  const data = source.flatMap((day) => [
    { date: day.date.slice(5), value: day.firstCompletions, type: '首训完成' },
    { date: day.date.slice(5), value: day.d1Retained, type: 'D1 有效学习' },
    { date: day.date.slice(5), value: day.sevenDayThreePractice, type: '7 日三练' },
  ])
  return <Line
    data={data}
    xField="date"
    yField="value"
    colorField="type"
    height={260}
    scale={{ color: { range: ['#aaa8ed', '#5b5bd6', '#36a678'] }, y: { domainMin: 0 } }}
    axis={{ y: { title: '账号数' }, x: { title: false } }}
    legend={{ color: { position: 'top' } }}
    style={{ lineWidth: 3 }}
  />
}
