import { labelAnchor, labelOffsetsSchema } from '../core/labels'
import {
  applyPatch,
  diffDocuments,
  errorMessage,
  exportModel,
  importModel,
  validateDocument,
} from '../core/schema'
import { routeConnector } from '../core/geometry'
import { emptyDocument, uid, type DocumentRecord } from '../core/types'
import { database, recordKey, type LocalRecord } from '../persistence/local'

let record: LocalRecord | null = null
let queue = Promise.resolve()
async function persist() {
  if (!record) return
  const db = await database()
  await db.put('documents', record)
}
async function handle(type: string, payload: any): Promise<unknown> {
  if (type === 'import') return importModel(JSON.parse(payload))
  if (type === 'export') return JSON.stringify(exportModel(payload ?? record!.document), null, 2)
  if (type === 'route') {
    const map = new Map<string, any>(payload.equipment.map((e: any) => [e.key, e]))
    return {
      revision: payload.revision,
      connectors: payload.connectors.map((c: any) => ({ ...c, points: routeConnector(c, map) })),
    }
  }
  if (type === 'initialize') {
    record = payload as LocalRecord
    record.document = validateDocument(record.document)
    await persist()
    return record
  }
  if (!record) throw new Error('Local project is not initialized')
  if (type === 'patch') {
    record.document = applyPatch(record.document, payload)
    record.sequence++
    record.dirty = true
    record.updated_at = new Date().toISOString()
    await persist()
    return { sequence: record.sequence }
  }
  if (type === 'labelPatch') {
    const patch = labelOffsetsSchema.parse(payload)
    const view = (record.view ??= { offsets: {}, dirty: {} })
    view.offsets = { ...view.offsets, ...patch }
    view.dirty = { ...view.dirty, ...patch }
    await persist()
    return true
  }
  if (type === 'prepareView') {
    const view = record.view
    if (!view || (!view.pending && !Object.keys(view.dirty).length)) return null
    view.pending ??= { ...view.dirty }
    await persist()
    return { id: record.id, offsets: view.pending }
  }
  if (type === 'ackView') {
    const view = record.view
    if (!view?.pending) return { dirty: false }
    for (const [key, point] of Object.entries(view.pending)) {
      const dirty = view.dirty[key]
      if (dirty?.x === point.x && dirty.y === point.y && labelAnchor(dirty) === labelAnchor(point))
        delete view.dirty[key]
    }
    view.pending = undefined
    await persist()
    return { dirty: Object.keys(view.dirty).length > 0 }
  }
  if (type === 'flush') {
    await persist()
    return true
  }
  if (type === 'snapshot') return record.document
  if (type === 'prepare') {
    if (!record.dirty) return null
    if (!record.pending) {
      record.pending = {
        mutation_id: uid(),
        expected_revision: record.revision,
        sequence: record.sequence,
        target: record.document,
        ...(record.needsCreate
          ? { document: record.document }
          : { patch: diffDocuments(record.base, record.document) }),
      }
      await persist()
    }
    const { target: _, ...request } = record.pending
    return { id: record.id, create: record.needsCreate, request }
  }
  if (type === 'ack') {
    if (!record.pending) return true
    record.base = record.pending.target
    record.revision = payload.revision
    record.needsCreate = false
    record.dirty = record.sequence !== record.pending.sequence
    record.pending = undefined
    await persist()
    return { dirty: record.dirty }
  }
  if (type === 'localAck') {
    // Keep private layout changes queued so a later connected session can sync them.
    record.base = record.document
    record.dirty = false
    record.pending = undefined
    await persist()
    return true
  }
  if (type === 'recover') {
    const oldKey = record.key
    const id = record.recoveryId ?? uid()
    const name = `${record.document.model_name} — recovered ${new Date().toLocaleString()}`
    record = {
      ...record,
      id,
      key: recordKey(record.owner, id),
      document: { ...record.document, model_name: name },
      base: emptyDocument(),
      revision: 0,
      dirty: true,
      needsCreate: true,
      pending: undefined,
      recoveryId: undefined,
      view: record.view
        ? { offsets: record.view.offsets, dirty: { ...record.view.offsets } }
        : undefined,
    }
    const db = await database()
    const tx = db.transaction('documents', 'readwrite')
    await tx.store.put(record)
    await tx.store.delete(oldKey)
    await tx.done
    return { id, name }
  }
  throw new Error('Unknown worker operation')
}
self.onmessage = (event: MessageEvent<{ id: number; type: string; payload: unknown }>) => {
  const { id, type, payload } = event.data
  queue = queue.then(async () => {
    try {
      const result = await handle(type, payload)
      self.postMessage({ id, result })
    } catch (error) {
      self.postMessage({ id, error: errorMessage(error) })
    }
  })
}
