import { describe, expect, it } from 'vitest'
import { Editor } from '../src/core/editor'
import { endpointPosition } from '../src/core/geometry'
import {
  applyPatch,
  diffDocuments,
  exportModel,
  importModel,
  patchSchema,
  validateDocument,
} from '../src/core/schema'
import { emptyDocument } from '../src/core/types'

describe.each(['indoor_drawout_breaker', 'outdoor_mv_hv_breaker'] as const)('%s', (type) => {
  it('creates numbered IDs and preserves the type through copy, save and JSON round-trip', () => {
    const e = new Editor()
    const key = e.add(type, { x: 0, y: 0 })
    expect(e.equipment.get(key)!.id).toBe(`${type}_1`)
    e.update(key, { kv_rating: 13.8, amp_rating: 1200 })
    const original = e.snapshot()
    const copy = [...e.paste(e.copy())][0]
    expect(e.equipment.get(copy)).toMatchObject({
      id: `${type}_2`,
      equipment_type: type,
      kv_rating: 13.8,
      amp_rating: 1200,
    })
    expect(applyPatch(original, diffDocuments(original, e.snapshot()))).toEqual(e.snapshot())
    expect(new Editor(e.snapshot()).snapshot()).toEqual(e.snapshot())
    const model = exportModel(e.snapshot())
    expect(exportModel(importModel(model))).toEqual(model)
  })

  it('keeps connections and failovers attached through rotation and export', () => {
    const e = new Editor()
    const source = e.add('utility_source', { x: 0, y: 0 })
    const key = e.add(type, { x: 0, y: 78 })
    expect(e.connectors.size).toBe(1)
    const load = e.add('load', { x: 0, y: 300 })
    const from = { equipment_key: key, port_id: 'out' }
    const to = { equipment_key: load, port_id: 'terminal' }
    expect(e.connect(from, to)).not.toBeNull()
    expect(e.connect(from, to)).toBeNull()
    const generator = e.add('generator', { x: 300, y: 0 })
    e.setFailover(key, [source], generator)
    e.select([key, load])
    e.group()
    e.rotate(new Set([key]))
    const model = exportModel(e.snapshot())
    expect(model.equipment.find((v) => v.equipment_type === type)!.connections).toHaveLength(2)
    expect(exportModel(importModel(model))).toEqual(model)
  })
})

it.each(['hv_breaker', 'outdoor_breaker', 'outdoor_mv_breaker', 'unknown_breaker'])(
  'rejects unsupported equipment type %s in imports, documents and patches',
  (equipment_type) => {
    const e = new Editor()
    e.add('indoor_drawout_breaker', { x: 0, y: 0 })
    const document = e.snapshot()
    const model = exportModel(document)
    expect(() =>
      importModel({
        ...model,
        equipment: model.equipment.map((v) => ({ ...v, equipment_type })),
      }),
    ).toThrow()
    expect(() =>
      validateDocument({
        ...document,
        equipment: document.equipment.map((v) => ({ ...v, equipment_type })),
      }),
    ).toThrow()
    const patch = diffDocuments(emptyDocument(), document)
    expect(() =>
      patchSchema.parse({
        ...patch,
        equipment: {
          ...patch.equipment,
          put: patch.equipment.put.map((v) => ({ ...v, equipment_type })),
        },
      }),
    ).toThrow()
  },
)

describe('Disconnect switch', () => {
  it('snaps onto a source, accepts one connector per terminal and rotates its connected endpoints', () => {
    const e = new Editor()
    const source = e.add('utility_source', { x: 0, y: 0 })
    const key = e.add('disconnect_switch', { x: 0, y: 78 })
    expect(e.equipment.get(key)!.id).toBe('disconnect_switch_1')
    expect(e.connectors.size).toBe(1)
    const load = e.add('load', { x: 0, y: 300 })
    const from = { equipment_key: key, port_id: 'out' }
    const to = { equipment_key: load, port_id: 'terminal' }
    expect(e.connect(from, to)).not.toBeNull()
    expect(e.connect(from, to)).toBeNull()
    expect(e.connect({ equipment_key: source, port_id: 'terminal' }, from)).toBeNull()
    e.rotate(new Set([key]))
    expect(endpointPosition(e.equipment.get(key)!, { port_id: 'in' })).toMatchObject({
      x: 40,
      y: 78,
    })
    const model = exportModel(e.snapshot())
    expect(
      model.equipment.find((v) => v.equipment_type === 'disconnect_switch')!.connections,
    ).toHaveLength(2)
    expect(exportModel(importModel(model))).toEqual(model)
    e.undo()
    expect(e.equipment.get(key)!.rotation).toBe(0)
    e.redo()
    expect(exportModel(e.snapshot())).toEqual(model)
  })

  it('duplicates a connected switch group with ratings and internal wiring through save and undo', () => {
    const e = new Editor()
    const key = e.add('disconnect_switch', { x: 0, y: 0 })
    const load = e.add('load', { x: 0, y: 200 })
    e.connect({ equipment_key: key, port_id: 'out' }, { equipment_key: load, port_id: 'terminal' })
    e.update(key, { kv_rating: 34.5, amp_rating: 600, derating_multiplier: 0.95 })
    e.select([key, load])
    e.group()
    const before = e.snapshot()
    e.duplicate()
    const after = e.snapshot()
    const copy = after.equipment.find((v) => v.id === 'disconnect_switch_2')!
    expect(copy).toMatchObject({ kv_rating: 34.5, amp_rating: 600, derating_multiplier: 0.95 })
    expect(after.connectors).toHaveLength(2)
    expect(after.groups).toHaveLength(2)
    expect(applyPatch(before, diffDocuments(before, after))).toEqual(after)
    expect(applyPatch(emptyDocument(), diffDocuments(emptyDocument(), after))).toEqual(after)
    expect(exportModel(importModel(exportModel(after)))).toEqual(exportModel(after))
    e.undo()
    expect(e.snapshot()).toEqual(before)
    e.redo()
    expect(e.snapshot()).toEqual(after)
  })
})
