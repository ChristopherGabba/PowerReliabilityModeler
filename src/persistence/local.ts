import type { LabelOffsets } from '../core/labels'
import { openDB } from 'idb'
import type { DocumentRecord, Patch, ProjectSummary } from '../core/types'
export type Pending = {
  mutation_id: string
  expected_revision: number
  patch?: Patch
  document?: DocumentRecord
  target: DocumentRecord
  sequence: number
}
export type LocalRecord = {
  key: string
  owner: string
  id: string
  document: DocumentRecord
  base: DocumentRecord
  revision: number
  dirty: boolean
  sequence: number
  updated_at: string
  pending?: Pending
  needsCreate: boolean
  view?: { offsets: LabelOffsets; dirty: LabelOffsets; pending?: LabelOffsets }
  recoveryId?: string
}
// The database name is a persistent identity, retained across the product rename.
export const database = () =>
  openDB('power-reliability-modeler', 1, {
    upgrade(db) {
      db.createObjectStore('documents', { keyPath: 'key' })
      db.createObjectStore('catalog', { keyPath: 'key' })
    },
  })
export const recordKey = (owner: string, id: string) => `${owner}:${id}`
export async function loadLocal(owner: string, id: string): Promise<LocalRecord | undefined> {
  const db = await database()
  return db.get('documents', recordKey(owner, id))
}
export async function localProjects(owner: string): Promise<ProjectSummary[]> {
  const db = await database()
  const records = (await db.getAll('documents')) as LocalRecord[]
  return records
    .filter((r) => r.owner === owner)
    .map((r) => ({
      id: r.id,
      name: r.document.model_name,
      created_at: r.updated_at,
      updated_at: r.updated_at,
      equipment_count: r.document.equipment.length,
    }))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
}
export async function removeLocal(owner: string, id: string) {
  const db = await database()
  await db.delete('documents', recordKey(owner, id))
}
