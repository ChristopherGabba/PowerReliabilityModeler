import { GraphicsPath, type Graphics } from 'pixi.js'
import { DIAGRAM_STROKE_WIDTH, equipmentSymbolFill, equipmentSymbolPath } from '../core/symbols'
import type { EquipmentType } from '../core/types'

const paths = new Map<EquipmentType, GraphicsPath>()
const fills = new Map<EquipmentType, GraphicsPath>()

export function drawEquipmentSymbol(
  graphics: Graphics,
  type: EquipmentType,
  color: number,
  busLength = 200,
) {
  if (type === 'bus') {
    graphics.moveTo(-busLength / 2, 0).lineTo(busLength / 2, 0)
  } else {
    let path = paths.get(type)
    if (!path) {
      path = new GraphicsPath(equipmentSymbolPath(type))
      paths.set(type, path)
    }
    graphics.path(path)
  }
  graphics.stroke({ width: DIAGRAM_STROKE_WIDTH, color, cap: 'butt', join: 'round' })
  const fill = equipmentSymbolFill(type)
  if (fill) {
    let path = fills.get(type)
    if (!path) {
      path = new GraphicsPath(fill)
      fills.set(type, path)
    }
    graphics.path(path).fill(color)
  }
}
