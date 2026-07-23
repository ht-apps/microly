import Editor, { loader, type OnMount } from '@monaco-editor/react'
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import * as monaco from 'monaco-editor/editor/editor.main.js'
import 'monaco-editor/language/json/monaco.contribution.js'
import editorWorker from 'monaco-editor/editor/editor.worker.js?worker'
import jsonWorker from 'monaco-editor/language/json/json.worker.js?worker'
import type { editor as MonacoEditor, MarkerSeverity } from 'monaco-editor'

import { findJsonNodeOffset } from './json-location'

self.MonacoEnvironment = {
  getWorker(_moduleId, label) {
    return label === 'json' ? new jsonWorker() : new editorWorker()
  },
}
loader.config({ monaco })

export type EditorIssue = { path: string; message: string; severity: 'error' | 'warning' }
export type JsonEditorHandle = { format: () => void; revealPath: (path: string) => void }

export const JsonEditor = forwardRef<JsonEditorHandle, {
  value: string
  issues: EditorIssue[]
  onChange: (value: string) => void
}>(({ value, issues, onChange }, ref) => {
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<typeof monaco | null>(null)
  const mount: OnMount = (editor, monaco) => {
    editorRef.current = editor
    monacoRef.current = monaco
  }
  const revealPath = (path: string) => {
    const editor = editorRef.current
    const model = editor?.getModel()
    const node = findJsonNodeOffset(value, path)
    if (!editor || !model || !node) return
    const position = model.getPositionAt(node.offset)
    editor.revealPositionInCenter(position)
    editor.setPosition(position)
    editor.focus()
  }
  useImperativeHandle(ref, () => ({
    format: () => { void editorRef.current?.getAction('editor.action.formatDocument')?.run() },
    revealPath,
  }))
  useEffect(() => {
    const editor = editorRef.current
    const monaco = monacoRef.current
    const model = editor?.getModel()
    if (!editor || !monaco || !model) return
    const markers = issues.flatMap((issue) => {
      const node = findJsonNodeOffset(value, issue.path)
      if (!node) return []
      const start = model.getPositionAt(node.offset)
      const end = model.getPositionAt(node.offset + Math.max(1, node.length))
      return [{
        startLineNumber: start.lineNumber, startColumn: start.column,
        endLineNumber: end.lineNumber, endColumn: end.column,
        message: issue.message,
        severity: (issue.severity === 'error' ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning) as MarkerSeverity,
      }]
    })
    monaco.editor.setModelMarkers(model, 'microly-validation', markers)
  }, [issues, value])
  return <Editor
    height="620px"
    language="json"
    value={value}
    onChange={(next) => onChange(next ?? '')}
    onMount={mount}
    loading="正在加载 JSON 编辑器…"
    options={{
      automaticLayout: true,
      minimap: { enabled: false },
      folding: true,
      formatOnPaste: true,
      scrollBeyondLastLine: false,
      tabSize: 2,
      wordWrap: 'off',
    }}
  />
})

JsonEditor.displayName = 'JsonEditor'
