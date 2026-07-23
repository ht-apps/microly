import { Line } from '@ant-design/plots'
import type { AdminMetrics } from '@microly/api-contract'

export default function MetricsChart({ daily }: { daily: AdminMetrics['daily'] }) {
  const data = daily.flatMap((day) => [
    { date: day.date.slice(5), value: day.starts, type: '开始训练' },
    { date: day.date.slice(5), value: day.completions, type: '完成训练' },
  ])
  return <Line
    data={data}
    xField="date"
    yField="value"
    colorField="type"
    height={280}
    scale={{ color: { range: ['#aaa8ed', '#5b5bd6'] }, y: { domainMin: 0 } }}
    axis={{ y: { title: '账号数' }, x: { title: false } }}
    legend={{ color: { position: 'top' } }}
    style={{ lineWidth: 3 }}
  />
}
