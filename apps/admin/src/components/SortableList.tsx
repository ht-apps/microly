import { HolderOutlined } from '@ant-design/icons'
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { ReactNode } from 'react'

function SortableRow({ id, children, disabled }: { id: string; children: ReactNode; disabled?: boolean }) {
  const sortable = useSortable({ id, disabled })
  return <div ref={sortable.setNodeRef} className="sortable-row" style={{ transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition }}>
    {!disabled && <button type="button" className="sortable-handle" aria-label="拖拽排序" {...sortable.attributes} {...sortable.listeners}><HolderOutlined /></button>}
    <div className="sortable-row__content">{children}</div>
  </div>
}

export function SortableList<T extends { id: string }>({ items, onChange, renderItem, disabled }: {
  items: T[]
  onChange: (items: T[]) => void
  renderItem: (item: T, index: number) => ReactNode
  disabled?: boolean
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const end = (event: DragEndEvent) => {
    if (!event.over || event.active.id === event.over.id) return
    const from = items.findIndex((item) => item.id === event.active.id)
    const to = items.findIndex((item) => item.id === event.over?.id)
    if (from >= 0 && to >= 0) onChange(arrayMove(items, from, to))
  }
  return <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={end}>
    <SortableContext items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
      <div className="sortable-list">{items.map((item, index) => <SortableRow id={item.id} key={item.id} disabled={disabled}>{renderItem(item, index)}</SortableRow>)}</div>
    </SortableContext>
  </DndContext>
}
