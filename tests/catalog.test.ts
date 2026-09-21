import { describe, expect, it } from 'vitest'
import { Editor } from '../src/core/editor'
import { exampleDocument } from '../src/core/fixtures'
import { endpointPosition } from '../src/core/geometry'
import { applyPatch, diffDocuments, exportModel, importModel } from '../src/core/schema'
import { emptyDocument } from '../src/core/types'

// Emulate persisted data from the version before the outdoor breaker was renamed.
function legacyType<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value).replaceAll(
      '"equipment_type":"outdoor_breaker"',
      '"equipment_type":"outdoor_mv_breaker"',
    ),
  )
}

describe('Equipment catalog compatibility', () => {
  it('imports the old outdoor type without changing IDs, ratings, paths, groups or failovers', () => {
    const e = new Editor(exampleDocument())
    const key = [...e.equipment.values()].find((v) => v.equipment_type === 'outdoor_breaker')!.key
    e.update(key, { id: 'outdoor_mv_breaker_1', kv_rating: 13.8, amp_rating: 1200 })
    e.select([key, [...e.equipment.keys()].find((k) => k !== key)!])
    e.group()
    const expected = exportModel(e.snapshot())
    const imported = importModel(legacyType(expected))
    expect(exportModel(imported)).toEqual(expected)
    expect(imported.equipment.find((v) => v.id === 'outdoor_mv_breaker_1')!.equipment_type).toBe(
      'outdoor_breaker',
    )
  })

  it('loads old local documents, clipboard data and queued patches using the canonical type', () => {
    const original = exampleDocument()
    const e = new Editor(legacyType(original))
    expect(e.snapshot()).toEqual(original)
    const key = [...e.equipment.values()].find((v) => v.equipment_type === 'outdoor_breaker')!.key
    e.update(key, { amp_rating: 2000 })
    const patch = legacyType(diffDocuments(original, e.snapshot()))
    expect(applyPatch(legacyType(original), patch)).toEqual(e.snapshot())
    e.select([key])
    const copy = [...e.paste(legacyType(e.copy()))][0]
    expect(e.equipment.get(copy)!.equipment_type).toBe('outdoor_breaker')
  })

  it('creates numbered outdoor breaker IDs and rejects unknown equipment types', () => {
    const e = new Editor()
    const key = e.add('outdoor_breaker', { x: 0, y: 0 })
    expect(e.equipment.get(key)!.id).toBe('outdoor_breaker_1')
    expect(e.equipment.get([...e.duplicate()][0])!.id).toBe('outdoor_breaker_2')
    const model = exportModel(e.snapshot())
    expect(() =>
      importModel({
        ...model,
        equipment: model.equipment.map((v) => ({ ...v, equipment_type: 'unknown_breaker' })),
      }),
    ).toThrow()
  })
})

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
