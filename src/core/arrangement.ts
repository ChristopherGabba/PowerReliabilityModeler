import { boundsOf, equipmentBounds } from './geometry'
import type { Bounds, EquipmentRecord, GroupRecord, Point } from './types'

export const ARRANGEMENT_LABELS = {
  top: 'Align top',
  middle: 'Align middle',
  bottom: 'Align bottom',
  left: 'Align left',
  center: 'Align center',
  right: 'Align right',
  horizontal: 'Distribute evenly left to right',
  vertical: 'Distribute evenly top to bottom',
} as const
export type Arrangement = keyof typeof ARRANGEMENT_LABELS

// A fully selected visual group is one object. A deliberately selected subset
// (for example, through the inspector) still operates on those individual items.
export function selectionUnits(selection: Set<string>, groups: GroupRecord[]): string[][] {
  const remaining = new Set(selection)
  const units: string[][] = []
  for (const group of groups) {
    if (group.equipment_keys.every((key) => remaining.has(key))) {
      units.push(group.equipment_keys)
      for (const key of group.equipment_keys) remaining.delete(key)
    }
  }
  for (const key of remaining) units.push([key])
  return units
}

export function arrangementTranslations(
  equipment: Map<string, EquipmentRecord>,
  groups: GroupRecord[],
  selection: Set<string>,
  action: Arrangement,
): Map<string, Point> {
  const translations = new Map<string, Point>()
  const units = selectionUnits(selection, groups).flatMap((keys) => {
    const points: Point[] = []
    for (const key of keys) {
      const item = equipment.get(key)
      if (!item) continue
      const b = equipmentBounds(item)
      points.push({ x: b.minX, y: b.minY }, { x: b.maxX, y: b.maxY })
    }
    return points.length ? [{ keys, bounds: boundsOf(points) }] : []
  })
  const distribute = action === 'horizontal' || action === 'vertical'
  if (units.length < (distribute ? 3 : 2)) return translations
  const horizontal = ['left', 'center', 'right', 'horizontal'].includes(action)
  const min: keyof Bounds = horizontal ? 'minX' : 'minY'
  const max: keyof Bounds = horizontal ? 'maxX' : 'maxY'
  const center = (b: Bounds) => (b[min] + b[max]) / 2
  const shift = (unit: (typeof units)[number], delta: number) => {
    if (Math.abs(delta) < 1e-8) return
    for (const key of unit.keys)
      translations.set(key, horizontal ? { x: delta, y: 0 } : { x: 0, y: delta })
  }
  if (distribute) {
    units.sort((a, b) => center(a.bounds) - center(b.bounds) || a.keys[0].localeCompare(b.keys[0]))
    const first = units[0],
      last = units[units.length - 1]
    let interiorSize = 0
    for (let i = 1; i < units.length - 1; i++)
      interiorSize += units[i].bounds[max] - units[i].bounds[min]
    const gap = (last.bounds[min] - first.bounds[max] - interiorSize) / (units.length - 1)
    let cursor = first.bounds[max] + gap
    for (let i = 1; i < units.length - 1; i++) {
      const unit = units[i]
      shift(unit, cursor - unit.bounds[min])
      cursor += unit.bounds[max] - unit.bounds[min] + gap
    }
  } else {
    let start = Infinity,
      end = -Infinity
    for (const unit of units) {
      start = Math.min(start, unit.bounds[min])
      end = Math.max(end, unit.bounds[max])
    }
    const leading = action === 'left' || action === 'top'
    const trailing = action === 'right' || action === 'bottom'
    const target = leading ? start : trailing ? end : (start + end) / 2
    for (const unit of units)
      shift(
        unit,
        target - (leading ? unit.bounds[min] : trailing ? unit.bounds[max] : center(unit.bounds)),
      )
  }
  return translations
}
