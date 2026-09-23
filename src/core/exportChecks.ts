import type { DocumentRecord } from './types'

export type ExportIssue = { key: string; id: string; message: string }

export function exportIssues(
  document: Pick<DocumentRecord, 'equipment' | 'failovers'>,
): ExportIssue[] {
  const incompleteFailovers = new Set(
    document.failovers
      .filter((f) => !f.parent_key || !f.trigger_keys.length)
      .map((f) => f.equipment_key),
  )
  return document.equipment.flatMap((item) => {
    const missing = []
    if (item.kv_rating == null) missing.push('voltage (kV)')
    if (item.amp_rating == null) missing.push('current (A)')
    const messages = []
    if (missing.length) messages.push(`Missing ${missing.join(' and ')}`)
    if (incompleteFailovers.has(item.key)) messages.push('Complete or remove the failover')
    return messages.length ? [{ key: item.key, id: item.id, message: messages.join('. ') }] : []
  })
}
