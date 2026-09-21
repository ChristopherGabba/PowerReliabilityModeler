import { describe, expect, it } from 'vitest'
import { Editor } from '../src/core/editor'
import { equipmentBounds, endpointPosition } from '../src/core/geometry'
import { exportModel, importModel, validateDocument } from '../src/core/schema'
import { selectionUnits, type Arrangement } from '../src/core/arrangement'
import type { Bounds, Patch } from '../src/core/types'

function fixture() {
  const editor = new Editor()
  const keys = [
    editor.add('indoor_drawout_breaker', { x: 100, y: 120 }),
    editor.add('oil_filled_transformer', { x: 360, y: 390 }),
    editor.add('bus', { x: 880, y: 710 }),
  ]
  editor.rotate(new Set([keys[1]]))
  const outside = editor.add('generator', { x: 1400, y: 1000 })
  editor.select(keys)
  return { editor, keys, outside }
}

describe('Selection arrangement', () => {
  it.each([
    ['top', 'minY', null],
    ['middle', 'minY', 'maxY'],
    ['bottom', 'maxY', null],
    ['left', 'minX', null],
    ['center', 'minX', 'maxX'],
    ['right', 'maxX', null],
  ] as [Arrangement, keyof Bounds, keyof Bounds | null][])(
    '%s aligns mixed sizes and rotated equipment in a single undo step',
    (action, edge, other) => {
      const { editor: e, keys, outside } = fixture()
      const before = e.snapshot(),
        bounds = e.selectionBounds()!
      const target = other ? (bounds[edge] + bounds[other]) / 2 : bounds[edge]
      const patches: Patch[] = []
      e.onChange((patch) => patches.push(patch))
      e.arrange(action)
      for (const key of keys) {
        const b = equipmentBounds(e.equipment.get(key)!)
        expect(other ? (b[edge] + b[other]) / 2 : b[edge]).toBeCloseTo(target, 8)
        const untouchedAxis = ['top', 'middle', 'bottom'].includes(action) ? 'x' : 'y'
        expect(e.equipment.get(key)![untouchedAxis]).toBe(
          before.equipment.find((v) => v.key === key)![untouchedAxis],
        )
      }
      expect(e.equipment.get(outside)).toEqual(before.equipment.find((v) => v.key === outside))
      expect(patches).toHaveLength(1)
      const after = e.snapshot()
      e.undo()
      expect(e.snapshot()).toEqual(before)
      e.redo()
      expect(e.snapshot()).toEqual(after)
      e.arrange(action)
      expect(e.snapshot()).toEqual(after)
      expect(patches).toHaveLength(3) // No extra undo step for an already aligned selection.
    },
  )

  it.each(['horizontal', 'vertical'] as const)(
    '%s distribution uses equal gaps and fixes the outer items',
    (axis) => {
      const { editor: e, keys } = fixture()
      const before = e.snapshot()
      const min = axis === 'horizontal' ? 'minX' : 'minY',
        max = axis === 'horizontal' ? 'maxX' : 'maxY'
      e.arrange(axis)
      const b = keys.map((key) => equipmentBounds(e.equipment.get(key)!))
      expect(b[1][min] - b[0][max]).toBeCloseTo(b[2][min] - b[1][max], 8)
      for (const key of [keys[0], keys[2]])
        expect(e.equipment.get(key)).toEqual(before.equipment.find((v) => v.key === key))
      validateDocument(e.snapshot())
      e.undo()
      expect(e.snapshot()).toEqual(before)
    },
  )

  it('distributes several interior items and a visual group with equal edge gaps', () => {
    const e = new Editor()
    const first = e.add('utility_source', { x: 0, y: 0 })
    const a = e.add('indoor_drawout_breaker', { x: 180, y: 90 })
    const b = e.add('indoor_drawout_breaker', { x: 260, y: 180 })
    e.select([a, b])
    e.group()
    const middle = e.add('ring_main_unit', { x: 540, y: 0 })
    const next = e.add('dry_type_transformer', { x: 720, y: 130 })
    const last = e.add('bus', { x: 1300, y: 0 })
    e.select([first, a, b, middle, next, last])
    const difference = e.equipment.get(b)!.x - e.equipment.get(a)!.x
    e.arrange('horizontal')
    const units = selectionUnits(e.selection, e.groups)
      .map((keys) => e.selectionBounds(new Set(keys))!)
      .sort((a, b) => a.minX - b.minX)
    const gaps = units.slice(1).map((bounds, i) => bounds.minX - units[i].maxX)
    for (const gap of gaps) expect(gap).toBeCloseTo(gaps[0], 8)
    expect(e.equipment.get(b)!.x - e.equipment.get(a)!.x).toBeCloseTo(difference, 8)
    expect(e.equipment.get(first)!.x).toBe(0)
    expect(e.equipment.get(last)!.x).toBe(1300)
  })

  it('moves complete groups together, carrying manual wiring and labels without changing failovers', () => {
    const e = new Editor()
    const a = e.add('indoor_drawout_breaker', { x: 100, y: 300 })
    const b = e.add('dry_type_transformer', { x: 350, y: 500 })
    const target = e.add('generator', { x: 1000, y: 0 })
    e.connect({ equipment_key: a, port_id: 'out' }, { equipment_key: b, port_id: 'primary' })
    const wire = [...e.connectors.keys()][0]
    e.setBends(wire, [
      { x: 100, y: 400 },
      { x: 350, y: 400 },
    ])
    e.setFailover(b, [a], target)
    e.setLabelOffset(a, { x: 150, y: -20 })
    e.select([a, b])
    e.group()
    e.select([a, target])
    expect(selectionUnits(e.selection, e.groups)).toHaveLength(2)
    const before = e.snapshot(),
      labelBefore = e.labelPosition(e.equipment.get(a)!)
    e.arrange('top')
    const delta = e.equipment.get(a)!.y - before.equipment.find((v) => v.key === a)!.y
    expect(delta).not.toBe(0)
    expect(e.equipment.get(b)!.y - before.equipment.find((v) => v.key === b)!.y).toBe(delta)
    expect(e.connectors.get(wire)!.bends).toEqual(
      before.connectors[0].bends.map((p) => ({ x: p.x, y: p.y + delta })),
    )
    expect(e.labelPosition(e.equipment.get(a)!)).toEqual({
      x: labelBefore.x,
      y: labelBefore.y + delta,
    })
    expect(e.failovers).toEqual(before.failovers)
    expect(e.groups).toEqual(before.groups)
    validateDocument(e.snapshot())
    e.undo()
    expect(e.snapshot()).toEqual(before)
    e.select([a])
    const grouped = e.snapshot()
    e.arrange('center')
    expect(e.snapshot()).toEqual(grouped)
  })

  it('updates connectors once after varied movements, preserving bus taps, manual bends, ratings and JSON backlinks', () => {
    const e = new Editor()
    const bus = e.add('bus', { x: 450, y: 180 })
    e.rotate(new Set([bus]))
    const load = e.add('load', { x: 800, y: 400 })
    e.connect(
      { equipment_key: bus, port_id: 'bar', tap_offset: 75 },
      { equipment_key: load, port_id: 'terminal' },
    )
    const wire = [...e.connectors.keys()][0]
    e.setBends(wire, [
      { x: 600, y: 255 },
      { x: 600, y: 364 },
    ])
    e.update(load, { kv_rating: 13.8, amp_rating: 1200, derating_multiplier: 0.99 })
    e.select([bus, load])
    const before = e.snapshot(),
      patches: Patch[] = []
    e.onChange((p) => patches.push(p))
    e.arrange('middle')
    const connector = e.connectors.get(wire)!
    expect(patches[0].connectors.put).toHaveLength(1)
    expect(connector.from.tap_offset).toBe(75)
    expect(connector.bends).toEqual(before.connectors[0].bends)
    for (const [endpoint, point] of [
      [connector.from, connector.points[0]],
      [connector.to, connector.points.at(-1)!],
    ] as const) {
      const actual = endpointPosition(e.equipment.get(endpoint.equipment_key)!, endpoint)
      expect(point).toEqual({ x: actual.x, y: actual.y })
    }
    const model = exportModel(e.snapshot())
    expect(exportModel(importModel(model))).toEqual(model)
    expect(model.equipment.find((v) => v.equipment_type === 'load')!.kv_rating).toBe(13.8)
    e.undo()
    expect(e.snapshot()).toEqual(before)
  })

  it('does nothing with too few items and does not auto-connect newly coincident terminals', () => {
    const e = new Editor(),
      key = e.add('indoor_drawout_breaker', { x: 0, y: 0 })
    e.select([])
    e.arrange('top')
    e.select([key])
    e.arrange('top')
    const other = e.add('indoor_drawout_breaker', { x: 300, y: 80 })
    e.select([key, other])
    const before = e.snapshot()
    e.arrange('horizontal')
    expect(e.snapshot()).toEqual(before)
    e.arrange('left')
    expect(e.connectors.size).toBe(0)
    e.undo()
    expect(e.snapshot()).toEqual(before)
  })
})
