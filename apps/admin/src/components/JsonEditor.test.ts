import { describe, expect, it } from 'vitest'

import { findJsonNodeOffset } from './json-location'

describe('JSON editor path location', () => {
  it('定位对象和数组中的校验路径', () => {
    const source = JSON.stringify({ sessions: { example: { cards: [{ title: '场景' }, { title: '选择' }] } } }, null, 2)
    const location = findJsonNodeOffset(source, 'sessions.example.cards.1.title')
    expect(location).not.toBeNull()
    expect(source.slice(location?.offset, (location?.offset ?? 0) + (location?.length ?? 0))).toBe('"选择"')
  })

  it('未知路径不产生错误定位', () => {
    expect(findJsonNodeOffset('{"value":1}', 'sessions.missing')).toBeNull()
  })
})
