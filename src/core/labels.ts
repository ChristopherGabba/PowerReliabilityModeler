import { z } from 'zod'
import type { EquipmentRecord, Point } from './types'

// Private presentation state. Deliberately separate from DocumentRecord / ModelFile.
export type LabelOffset = Point & { anchor?: 'right' | 'below' }
export type LabelOffsets = Record<string, LabelOffset>
export function labelAnchor(offset?: LabelOffset): 'right' | 'below' {
  // Legacy zero offsets represent an undone drag, i.e. the default placement.
  return offset?.anchor ?? (offset && (offset.x !== 0 || offset.y !== 0) ? 'below' : 'right')
}
export const labelOffsetsSchema = z.record(
  z.string().min(1).max(200),
  z
    .object({
      x: z.number().finite(),
      y: z.number().finite(),
      anchor: z.enum(['right', 'below']).optional(),
    })
    .strict(),
)
const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 })
export function deratedMva(e: EquipmentRecord): number | null {
  if (e.kv_rating === null || e.amp_rating === null) return null
  const value = (Math.sqrt(3) * e.kv_rating * e.amp_rating * e.derating_multiplier) / 1000
  return Number.isFinite(value) ? value : null
}
export function mvaLabel(e: EquipmentRecord): string {
  const value = deratedMva(e)
  return `${value === null ? '—' : number.format(value)} MVA`
}
export function equipmentLabel(e: EquipmentRecord, details = true): string {
  if (!details) return e.id
  const format = (value: number | null) => (value === null ? '—' : number.format(value))
  return `${e.id}\n${format(e.kv_rating)} kV · ${format(e.amp_rating)} A\nDerating × ${format(e.derating_multiplier)}\n${mvaLabel(e)}`
}
