import { labelOffsetsSchema, type LabelOffsets } from '../src/core/labels'
import { DurableObject } from 'cloudflare:workers'
import { applyPatch, validateDocument } from '../src/core/schema'
import type { DocumentRecord, Patch } from '../src/core/types'
import type { Env } from './index'

type Meta = {
  document: Omit<DocumentRecord, 'equipment' | 'connectors'>
  revision: number
  owner: string
  deleted?: boolean
}
export class ProjectStore extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    ctx.storage.sql.exec(
      'CREATE TABLE IF NOT EXISTS label_offsets (id TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS metadata (id INTEGER PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS equipment (id TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS connectors (id TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS mutations (id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, revision INTEGER NOT NULL)',
    )
  }
  private meta(): Meta | null {
    const row = this.ctx.storage.sql
      .exec<{ value: string }>('SELECT value FROM metadata WHERE id=1')
      .toArray()[0]
    return row ? JSON.parse(row.value) : null
  }
  private read(meta: Meta): DocumentRecord {
    return {
      ...meta.document,
      equipment: this.ctx.storage.sql
        .exec<{ value: string }>('SELECT value FROM equipment ORDER BY rowid')
        .toArray()
        .map((r) => JSON.parse(r.value)),
      connectors: this.ctx.storage.sql
        .exec<{ value: string }>('SELECT value FROM connectors ORDER BY rowid')
        .toArray()
        .map((r) => JSON.parse(r.value)),
    }
  }
  initialize(owner: string, input: DocumentRecord) {
    const document = validateDocument(input)
    return this.ctx.storage.transactionSync(() => {
      const existing = this.meta()
      if (existing) {
        if (existing.owner !== owner || existing.deleted)
          return { error: 'Project ID is unavailable', status: 409 }
        return { document: this.read(existing), revision: existing.revision }
      }
      const { equipment, connectors, ...rest } = document
      this.ctx.storage.sql.exec(
        'INSERT INTO metadata(id,value) VALUES(1,?)',
        JSON.stringify({ owner, revision: 0, document: rest }),
      )
      for (const e of equipment)
        this.ctx.storage.sql.exec(
          'INSERT INTO equipment(id,value) VALUES(?,?)',
          e.key,
          JSON.stringify(e),
        )
      for (const c of connectors)
        this.ctx.storage.sql.exec(
          'INSERT INTO connectors(id,value) VALUES(?,?)',
          c.id,
          JSON.stringify(c),
        )
      return { document, revision: 0 }
    })
  }
  getDocument(owner: string) {
    const meta = this.meta()
    if (!meta || meta.deleted || meta.owner !== owner)
      return { error: 'Project not found', status: 404 }
    const label_offsets = Object.fromEntries(
      this.ctx.storage.sql
        .exec<{ id: string; value: string }>('SELECT id,value FROM label_offsets')
        .toArray()
        .map((row) => [row.id, JSON.parse(row.value)]),
    )
    return { document: this.read(meta), revision: meta.revision, label_offsets }
  }
  updateView(owner: string, input: LabelOffsets) {
    const offsets = labelOffsetsSchema.parse(input)
    return this.ctx.storage.transactionSync(() => {
      const meta = this.meta()
      if (!meta || meta.deleted || meta.owner !== owner)
        return { error: 'Project not found', status: 404 }
      for (const [key, point] of Object.entries(offsets))
        this.ctx.storage.sql.exec(
          'INSERT OR REPLACE INTO label_offsets(id,value) VALUES(?,?)',
          key,
          JSON.stringify(point),
        )
      return { ok: true }
    })
  }
  change(owner: string, expected: number, mutationId: string, fingerprint: string, patch: Patch) {
    return this.ctx.storage.transactionSync(() => {
      const meta = this.meta()
      if (!meta || meta.deleted || meta.owner !== owner)
        return { error: 'Project not found', status: 404 }
      const previous = this.ctx.storage.sql
        .exec<{ fingerprint: string; revision: number }>(
          'SELECT fingerprint,revision FROM mutations WHERE id=?',
          mutationId,
        )
        .toArray()[0]
      if (previous) {
        if (previous.fingerprint !== fingerprint)
          return { error: 'Mutation ID reused with different changes', status: 409 }
        return {
          revision: previous.revision,
          current_revision: meta.revision,
          name: meta.document.model_name,
          equipment_count: this.ctx.storage.sql
            .exec<{ count: number }>('SELECT COUNT(*) AS count FROM equipment')
            .one().count,
        }
      }
      if (meta.revision !== expected)
        return { error: 'Project changed on another device', status: 409, revision: meta.revision }
      const next = applyPatch(this.read(meta), patch)
      const { equipment: _, connectors: __, ...rest } = next
      for (const k of patch.equipment.remove)
        this.ctx.storage.sql.exec('DELETE FROM equipment WHERE id=?', k)
      for (const e of patch.equipment.put)
        this.ctx.storage.sql.exec(
          'INSERT OR REPLACE INTO equipment(id,value) VALUES(?,?)',
          e.key,
          JSON.stringify(e),
        )
      for (const k of patch.connectors.remove)
        this.ctx.storage.sql.exec('DELETE FROM connectors WHERE id=?', k)
      for (const c of patch.connectors.put)
        this.ctx.storage.sql.exec(
          'INSERT OR REPLACE INTO connectors(id,value) VALUES(?,?)',
          c.id,
          JSON.stringify(c),
        )
      const revision = meta.revision + 1
      this.ctx.storage.sql.exec(
        'UPDATE metadata SET value=? WHERE id=1',
        JSON.stringify({ ...meta, document: rest, revision }),
      )
      this.ctx.storage.sql.exec(
        'INSERT INTO mutations(id,fingerprint,revision) VALUES(?,?,?)',
        mutationId,
        fingerprint,
        revision,
      )
      return {
        revision,
        current_revision: revision,
        name: next.model_name,
        equipment_count: next.equipment.length,
      }
    })
  }
  remove(owner: string) {
    return this.ctx.storage.transactionSync(() => {
      const meta = this.meta()
      if (!meta || meta.owner !== owner) return false
      this.ctx.storage.sql.exec(
        'DELETE FROM equipment; DELETE FROM connectors; DELETE FROM mutations; DELETE FROM label_offsets',
      )
      this.ctx.storage.sql.exec(
        'UPDATE metadata SET value=? WHERE id=1',
        JSON.stringify({ ...meta, deleted: true }),
      )
      return true
    })
  }
}
