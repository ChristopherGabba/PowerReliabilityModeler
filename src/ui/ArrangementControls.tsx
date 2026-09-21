import { useMemo } from 'react'
import {
  AlignStartHorizontal,
  AlignCenterHorizontal,
  AlignEndHorizontal,
  AlignStartVertical,
  AlignCenterVertical,
  AlignEndVertical,
  AlignHorizontalSpaceBetween,
  AlignVerticalSpaceBetween,
  type LucideIcon,
} from 'lucide-react'
import { ARRANGEMENT_LABELS, selectionUnits, type Arrangement } from '../core/arrangement'
import type { Editor } from '../core/editor'

const sections: { label: string; actions: [Arrangement, LucideIcon][] }[] = [
  {
    label: 'Vertical alignment',
    actions: [
      ['top', AlignStartHorizontal],
      ['middle', AlignCenterHorizontal],
      ['bottom', AlignEndHorizontal],
    ],
  },
  {
    label: 'Horizontal alignment',
    actions: [
      ['left', AlignStartVertical],
      ['center', AlignCenterVertical],
      ['right', AlignEndVertical],
    ],
  },
  {
    label: 'Even spacing',
    actions: [
      ['horizontal', AlignHorizontalSpaceBetween],
      ['vertical', AlignVerticalSpaceBetween],
    ],
  },
]

export function ArrangementControls({
  editor,
  onAction,
}: {
  editor: Editor
  onAction: (action: Arrangement) => void
}) {
  const count = useMemo(
    () => selectionUnits(editor.selection, editor.groups).length,
    [editor.selection, editor.groups],
  )
  return (
    <div className="arrangement-controls" role="group" aria-label="Align and distribute selection">
      {sections.map((section) => (
        <div
          className="arrangement-section"
          role="group"
          aria-label={section.label}
          key={section.label}
        >
          {section.actions.map(([action, Icon]) => {
            const minimum = action === 'horizontal' || action === 'vertical' ? 3 : 2
            const label = ARRANGEMENT_LABELS[action]
            return (
              <button
                key={action}
                className="icon-button"
                aria-label={label}
                title={
                  count < minimum
                    ? `${label} · Select at least ${minimum} items or groups. Ungroup to arrange individual equipment.`
                    : label
                }
                disabled={count < minimum}
                onClick={() => onAction(action)}
              >
                <Icon size={16} />
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}
