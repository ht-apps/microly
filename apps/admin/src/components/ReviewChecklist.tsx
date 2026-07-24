import { Checkbox, Typography } from 'antd'

export function ReviewChecklist({ options, value = [], onChange }: {
  options: ReadonlyArray<readonly [string, string]>
  value?: string[]
  onChange?: (value: string[]) => void
}) {
  const allValues = options.map(([key]) => key)
  const selectedCount = value.filter((item) => allValues.includes(item)).length
  const allSelected = selectedCount === allValues.length
  const partiallySelected = selectedCount > 0 && !allSelected

  return <div className="content-review-checklist-field">
    <div className="content-review-checklist-toolbar">
      <Checkbox
        checked={allSelected}
        indeterminate={partiallySelected}
        onChange={(event) => onChange?.(event.target.checked ? allValues : [])}
      >
        全选
      </Checkbox>
      <Typography.Text type="secondary">{selectedCount} / {allValues.length}</Typography.Text>
    </div>
    <Checkbox.Group className="content-review-checklist" value={value} onChange={(items) => onChange?.(items as string[])}>
      {options.map(([key, label]) => <Checkbox key={key} value={key}>{label}</Checkbox>)}
    </Checkbox.Group>
  </div>
}
