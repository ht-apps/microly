import { App, ConfigProvider } from 'antd'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { createSession, type EditableBundle } from '../features/content/content-workspace'
import { ContentFormEditor } from './ContentFormEditor'

function bundle(): EditableBundle {
  const empty = {
    releaseVersion: 1,
    library: { schemaVersion: '1.0' as const, libraryId: 'test-library', contentVersion: 1, title: '测试课程', description: '这是一个用于测试的课程。', catalogIds: ['first-catalog'] },
    catalogs: { 'first-catalog': { schemaVersion: '1.0' as const, catalogId: 'first-catalog', contentVersion: 1, title: '第一章', skill: 'first-skill', description: '用于测试的章节。', sessionIds: [] } },
    sessions: {},
  } as EditableBundle
  return createSession(empty, 'first-catalog', '第一组训练').bundle
}

function renderEditor(props?: Partial<Parameters<typeof ContentFormEditor>[0]>) {
  const value = bundle()
  const onChange = vi.fn()
  function Harness() {
    const [current, setCurrent] = useState(value)
    return <ContentFormEditor bundle={current} issues={[]} selectedKey="library" onSelect={() => undefined} onChange={(next) => { setCurrent(next); onChange(next) }} {...props} />
  }
  render(<ConfigProvider><App><Harness /></App></ConfigProvider>)
  return { value, onChange }
}

describe('visual content form', () => {
  it('表单修改会产生完整的新内容包', async () => {
    const { onChange } = renderEditor()
    const user = userEvent.setup()
    const title = screen.getByLabelText('课程标题')
    await user.clear(title)
    await user.type(title, '新课程')
    expect(onChange).toHaveBeenCalled()
    expect(onChange.mock.lastCall?.[0].library.title).toBe('新课程')
    expect(onChange.mock.lastCall?.[0].sessions).toBeTruthy()
  })

  it('历史表单为只读', () => {
    renderEditor({ readOnly: true })
    expect((screen.getByLabelText('课程标题') as HTMLInputElement).disabled).toBe(true)
    expect(screen.queryByRole('button', { name: '新建章节' })).toBeNull()
  })
})
