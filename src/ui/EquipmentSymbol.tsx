import {
  DIAGRAM_STROKE_WIDTH,
  equipmentSymbolFill,
  equipmentSymbolPath,
  equipmentSymbolViewBox,
} from '../core/symbols'
import type { EquipmentType } from '../core/types'

export function EquipmentSymbolPaths({
  type,
  busLength,
  icon = false,
}: {
  type: EquipmentType
  busLength?: number
  icon?: boolean
}) {
  const fill = equipmentSymbolFill(type)
  return (
    <>
      <path
        d={equipmentSymbolPath(type, busLength)}
        fill="none"
        stroke="currentColor"
        strokeWidth={DIAGRAM_STROKE_WIDTH}
        strokeLinecap="butt"
        strokeLinejoin="round"
        vectorEffect={icon ? 'non-scaling-stroke' : undefined}
      />
      {fill && <path d={fill} fill="currentColor" />}
    </>
  )
}

export function EquipmentSymbol({ type }: { type: EquipmentType }) {
  return (
    <svg className="equipment-symbol" viewBox={equipmentSymbolViewBox(type)} aria-hidden="true">
      <EquipmentSymbolPaths type={type} icon />
    </svg>
  )
}
