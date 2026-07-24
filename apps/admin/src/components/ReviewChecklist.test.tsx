import { App, ConfigProvider } from 'antd'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'

import { ReviewChecklist } from './ReviewChecklist'

const options = [
  ['objective', '目标检查'],
  ['safety', '安全检查'],
  ['preview', '预览检查'],
] as const

function Harness() {
  const [value, setValue] = useState<string[]>([])
  return <ReviewChecklist options={options} value={value} onChange={setValue} />
}

describe('review checklist', () => {
  it('支持全选和取消全部检查项', async () => {
    const user = userEvent.setup()
    render(<ConfigProvider><App><Harness /></App></ConfigProvider>)

    await user.click(screen.getByRole('checkbox', { name: '全选' }))
    expect(screen.getByText('3 / 3')).toBeTruthy()
    expect(screen.getAllByRole('checkbox').every((item) => (item as HTMLInputElement).checked)).toBe(true)

    await user.click(screen.getByRole('checkbox', { name: '全选' }))
    expect(screen.getByText('0 / 3')).toBeTruthy()
    expect(screen.getAllByRole('checkbox').every((item) => !(item as HTMLInputElement).checked)).toBe(true)
  })

  it('部分选择时全选框进入半选状态', async () => {
    const user = userEvent.setup()
    render(<ConfigProvider><App><Harness /></App></ConfigProvider>)

    await user.click(screen.getByRole('checkbox', { name: '目标检查' }))
    expect(screen.getByRole('checkbox', { name: '全选' }).closest('.ant-checkbox')?.classList.contains('ant-checkbox-indeterminate')).toBe(true)
    expect(screen.getByText('1 / 3')).toBeTruthy()
  })
})
