import { findNodeAtLocation, parseTree } from 'jsonc-parser'

export function findJsonNodeOffset(value: string, path: string) {
  const tree = parseTree(value)
  if (!tree) return null
  const segments = path.split('.').filter(Boolean).map((segment) => /^\d+$/.test(segment) ? Number(segment) : segment)
  const node = findNodeAtLocation(tree, segments)
  return node ? { offset: node.offset, length: node.length } : null
}
