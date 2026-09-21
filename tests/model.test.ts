import { describe, expect, it } from 'vitest'
import { Editor } from '../src/core/editor'
import { emptyDocument, type EndpointRecord } from '../src/core/types'
import { applyPatch, exportModel, importModel, validateDocument } from '../src/core/schema'
import { endpointPosition, SpatialIndex } from '../src/core/geometry'
import { benchmarkDocument, exampleDocument } from '../src/core/fixtures'

function network() {
  const e = new Editor()
  const a = e.add('utility_source', { x: 0, y: 0 }),
    b = e.add('indoor_drawout_breaker', { x: 0, y: 180 }),
    bus = e.add('bus', { x: 0, y: 350 })
  e.connect({ equipment_key: a, port_id: 'terminal' }, { equipment_key: b, port_id: 'in' })
  e.connect(
    { equipment_key: b, port_id: 'out' },
    { equipment_key: bus, port_id: 'bar', tap_offset: 0 },
  )
  return { e, a, b, bus }
}
describe('Portable connected model', () => {
  it('round trips all equipment, paths, groups, and failovers without leaking internal keys', () => {
    const original = exampleDocument()
    const e = new Editor(original)
    e.select(original.equipment.slice(0, 3).map((v) => v.key))
    e.group()
    const exported = exportModel(e.snapshot())
    expect(exported.equipment.find((e) => e.id === 'utility_north')!.x).toBe(-260)
    expect(exported.equipment.find((e) => e.id === 'utility_north')!.connections).toHaveLength(1)
    expect(JSON.stringify(exported)).not.toContain('equipment_key')
    expect(exportModel(importModel(exported))).toEqual(exported)
  })
  it('renames referenced IDs without breaking graph or failover links', () => {
    const { e, a, b, bus } = network()
    e.setFailover(b, [a], bus)
    e.update(a, { id: 'utility_renamed' })
    const model = exportModel(e.snapshot())
    expect(model.connectors.some((c) => c.from.equipment_id === 'utility_renamed')).toBe(true)
    expect(
      model.equipment
        .find((v) => v.id === e.equipment.get(b)!.id)!
        .connections.some((c) => c.connected_equipment_id === 'utility_renamed'),
    ).toBe(true)
    expect(model.failovers[0].failover_trigger_ids).toEqual(['utility_renamed'])
    expect(() => e.update(b, { id: 'utility_renamed' })).toThrow('already exists')
  })
  it('rejects inconsistent backlinks, duplicate IDs, invalid terminals, nonfinite positions, and unsupported versions', () => {
    const model = exportModel(network().e.snapshot())
    const backlinks = structuredClone(model)
    backlinks.equipment[0].connections = []
    expect(() => importModel(backlinks)).toThrow('disagree')
    const duplicate = structuredClone(model)
    duplicate.equipment[1].id = duplicate.equipment[0].id
    expect(() => importModel(duplicate)).toThrow('Duplicate')
    const ports = structuredClone(model)
    ports.connectors.find((c) => c.from.port_id !== 'bar')!.from.port_id = 'nope'
    expect(() => importModel(ports)).toThrow('Invalid terminal')
    expect(() => importModel({ ...model, schema_version: 2 })).toThrow()
    const invalid = structuredClone(model)
    invalid.equipment[0].x = Infinity
    expect(() => importModel(invalid)).toThrow()
  })
  it('preserves rings without flattening them into a hierarchy', () => {
    const e = new Editor()
    const buses = [0, 1, 2].map((i) => e.add('bus', { x: i * 400, y: (i % 2) * 250 }))
    for (let i = 0; i < 3; i++)
      e.connect(
        { equipment_key: buses[i], port_id: 'bar', tap_offset: 0 },
        { equipment_key: buses[(i + 1) % 3], port_id: 'bar', tap_offset: 20 },
      )
    expect(exportModel(importModel(exportModel(e.snapshot()))).connectors).toHaveLength(3)
  })
})
describe('Editing transactions', () => {
  it.each([
    ['breaker_1', 'breaker_2', 'breaker_3'],
    ['transformer_009', 'transformer_010', 'transformer_011'],
    ['main9', 'main10', 'main11'],
    ['main', 'main_1', 'main_2'],
    ['breaker_1_1', 'breaker_1_2', 'breaker_1_3'],
    ['main_9007199254740992', 'main_9007199254740993', 'main_9007199254740994'],
  ])('increments copied IDs from %s without stacking suffixes', (original, first, second) => {
    const e = new Editor()
    const key = e.add('indoor_drawout_breaker', { x: 0, y: 0 })
    e.update(key, { id: original })
    const duplicateId = () => e.equipment.get([...e.duplicate()][0])!.id
    expect(duplicateId()).toBe(first)
    expect(duplicateId()).toBe(second)
    e.undo()
    expect(duplicateId()).toBe(second)
    validateDocument(e.snapshot())
  })
  it('skips occupied IDs on repeated paste and after a rename', () => {
    const e = new Editor()
    const first = e.add('indoor_drawout_breaker', { x: 0, y: 0 })
    const second = e.add('indoor_drawout_breaker', { x: 200, y: 0 })
    expect(e.equipment.get(second)!.id).toBe('indoor_drawout_breaker_2')
    e.select([first])
    const clipboard = e.copy()
    expect(e.equipment.get([...e.paste(clipboard)][0])!.id).toBe('indoor_drawout_breaker_3')
    e.update(second, { id: 'indoor_drawout_breaker_4' })
    expect(e.equipment.get([...e.paste(clipboard)][0])!.id).toBe('indoor_drawout_breaker_2')
    expect(e.equipment.get([...e.paste(clipboard)][0])!.id).toBe('indoor_drawout_breaker_5')
    validateDocument(e.snapshot())
  })
  it('numbers a bulk copy uniquely and retains its internal connections through undo', () => {
    const { e, a, b } = network()
    e.update(a, { id: 'equipment_1' })
    e.update(b, { id: 'equipment_2' })
    e.select([b, a])
    const before = exportModel(e.snapshot())
    e.duplicate()
    const copied = [...e.selection].map((key) => e.equipment.get(key)!)
    expect(copied.map((item) => item.id)).toEqual(['equipment_3', 'equipment_4'])
    const model = exportModel(e.snapshot())
    expect(
      model.connectors.some(
        (c) => c.from.equipment_id === 'equipment_4' && c.to.equipment_id === 'equipment_3',
      ),
    ).toBe(true)
    expect(new Set(model.equipment.map((item) => item.id)).size).toBe(model.equipment.length)
    e.undo()
    expect(exportModel(e.snapshot())).toEqual(before)
    e.redo()
    expect(exportModel(e.snapshot())).toEqual(model)
  })
  it('moves and rotates a group with correct endpoint coordinates and one undo step', () => {
    const { e, a, b } = network()
    const before = exportModel(e.snapshot())
    e.select([a, b])
    e.move(e.selection, 100, 50, false)
    validateDocument(e.snapshot())
    e.undo()
    expect(exportModel(e.snapshot())).toEqual(before)
    e.redo()
    e.rotate()
    validateDocument(e.snapshot())
    for (const c of e.connectors.values()) {
      const ep = endpointPosition(e.equipment.get(c.from.equipment_key)!, c.from)
      expect(c.points[0]).toEqual({ x: ep.x, y: ep.y })
    }
  })
  it('copies internal connectors and ratings, detaches external wires, and clears failovers', () => {
    const { e, a, b, bus } = network()
    e.update(b, { kv_rating: 13.8, amp_rating: 1200, derating_multiplier: 0.99 })
    e.setFailover(b, [a], bus)
    e.select([a, b])
    const keys = e.duplicate()
    expect(keys.size).toBe(2)
    expect(e.equipment.size).toBe(5)
    expect(e.connectors.size).toBe(3)
    const copy = [...keys]
      .map((k) => e.equipment.get(k)!)
      .find((v) => v.equipment_type === 'indoor_drawout_breaker')!
    expect(copy.kv_rating).toBe(13.8)
    expect(copy.derating_multiplier).toBe(0.99)
    expect(e.failovers).toHaveLength(1)
    validateDocument(e.snapshot())
    e.undo()
    expect(e.equipment.size).toBe(3)
    expect(e.connectors.size).toBe(2)
    e.redo()
    validateDocument(e.snapshot())
  })
  it('deletes referenced equipment and restores all relationships with Undo', () => {
    const { e, a, b, bus } = network()
    e.setFailover(b, [a], bus)
    const before = exportModel(e.snapshot())
    e.select([a])
    e.deleteSelection()
    expect(e.failovers).toHaveLength(0)
    expect(e.connectors.size).toBe(1)
    e.undo()
    expect(exportModel(e.snapshot())).toEqual(before)
  })
  it('keeps incomplete failovers locally but blocks portable export', () => {
    const { e, a, b } = network()
    e.setFailover(b, [a], null)
    expect(() => validateDocument(e.snapshot())).not.toThrow()
    expect(() => exportModel(e.snapshot())).toThrow('Complete or remove')
    e.removeFailover(b)
    expect(() => exportModel(e.snapshot())).not.toThrow()
  })
  it('replays emitted patches to produce exactly the same model', () => {
    const { e, a, b } = network()
    let remote = e.snapshot()
    e.onChange((patch) => {
      remote = applyPatch(remote, patch)
    })
    e.move(new Set([a]), 50, 0, false)
    e.select([a, b])
    e.group()
    e.duplicate()
    e.undo()
    e.redo()
    expect(exportModel(remote)).toEqual(exportModel(e.snapshot()))
  })
})
describe('Terminals and buses', () => {
  it('allows unlimited bus taps but only one connection per ordinary port', () => {
    const e = new Editor(),
      bus = e.add('bus', { x: 0, y: 0 })
    for (let i = 0; i < 20; i++) {
      const load = e.add('load', { x: i * 100, y: 200 })
      const from: EndpointRecord = { equipment_key: bus, port_id: 'bar', tap_offset: 0 },
        to = { equipment_key: load, port_id: 'terminal' }
      expect(e.connect(from, to)).not.toBeNull()
      expect(e.connect(from, to)).toBeNull()
    }
    expect(e.adjacency.get(bus)?.size).toBe(20)
    validateDocument(e.snapshot())
  })
  it('keeps taps fixed while resizing either end of a rotated bus', () => {
    const { e, bus } = network()
    e.rotate(new Set([bus]))
    const c = [...e.connectors.values()].find((c) => c.to.equipment_key === bus)!
    const before = endpointPosition(e.equipment.get(bus)!, c.to)
    const candidate = e.previewBus(bus, 1, { x: 0, y: 650 })
    e.resizeBus(bus, candidate)
    const updated = e.connectors.get(c.id)!
    expect(endpointPosition(e.equipment.get(bus)!, updated.to)).toEqual(before)
    validateDocument(e.snapshot())
  })
  it('clamps a shrinking bus before existing taps', () => {
    const { e, bus } = network()
    const result = e.previewBus(bus, -1, { x: 90, y: 350 })
    const projected = e.equipment.get(bus)!
    expect(result.x - (result.bus_length ?? 0) / 2).toBeLessThanOrEqual(projected.x)
    e.resizeBus(bus, result)
    validateDocument(e.snapshot())
  })
  it('finds a crossing connector when its endpoints are both outside the viewport', () => {
    const index = new SpatialIndex()
    index.set('wire', { minX: -1000, minY: 10, maxX: 1000, maxY: 10 })
    expect(index.query({ minX: -30, minY: 0, maxX: 30, maxY: 20 })).toEqual(['wire'])
  })
})
describe('Source connectivity', () => {
  it('follows physical wiring and updates after disconnect, undo, and redo', () => {
    const { e, bus } = network()
    const load = e.add('load', { x: 200, y: 500 })
    expect(e.isSourceConnected(bus)).toBe(true)
    expect(e.isSourceConnected(load)).toBe(false)
    const wire = e.connect(
      { equipment_key: load, port_id: 'terminal' },
      { equipment_key: bus, port_id: 'bar', tap_offset: 80 },
    )!
    expect(e.isSourceConnected(load)).toBe(true)
    e.selectConnector(wire)
    e.deleteSelection()
    expect(e.isSourceConnected(load)).toBe(false)
    e.undo()
    expect(e.isSourceConnected(load)).toBe(true)
    e.redo()
    expect(e.isSourceConnected(load)).toBe(false)
  })
  it('preserves source reachability through rings and either power source', () => {
    const e = new Editor()
    const buses = [0, 1, 2].map((i) => e.add('bus', { x: i * 400, y: 200 }))
    const utility = e.add('utility_source', { x: 0, y: 0 })
    const generator = e.add('generator', { x: 800, y: 0 })
    for (let i = 0; i < buses.length; i++)
      e.connect(
        { equipment_key: buses[i], port_id: 'bar', tap_offset: 40 },
        { equipment_key: buses[(i + 1) % buses.length], port_id: 'bar', tap_offset: -40 },
      )
    const utilityWire = e.connect(
      { equipment_key: utility, port_id: 'terminal' },
      { equipment_key: buses[0], port_id: 'bar', tap_offset: 0 },
    )!
    e.connect(
      { equipment_key: buses[2], port_id: 'bar', tap_offset: 0 },
      { equipment_key: generator, port_id: 'terminal' },
    )
    expect(buses.every((key) => e.isSourceConnected(key))).toBe(true)
    e.selectConnector(utilityWire)
    e.deleteSelection()
    expect(buses.every((key) => e.isSourceConnected(key))).toBe(true)
    e.select([generator], false)
    e.deleteSelection()
    expect(buses.every((key) => !e.isSourceConnected(key))).toBe(true)
    expect(e.isSourceConnected(utility)).toBe(true)
    expect(e.isSourceConnected(generator)).toBe(false)
    e.undo()
    expect(buses.every((key) => e.isSourceConnected(key))).toBe(true)
    const restored = new Editor(importModel(exportModel(e.snapshot())))
    expect([...restored.equipment.keys()].every((key) => restored.isSourceConnected(key))).toBe(
      true,
    )
  })
  it('does not treat failovers or visual groups as physical connections', () => {
    const e = new Editor()
    const source = e.add('generator', { x: 0, y: 0 })
    const load = e.add('load', { x: 400, y: 400 })
    const trigger = e.add('indoor_drawout_breaker', { x: 800, y: 400 })
    e.setFailover(load, [trigger], source)
    e.select([source, load, trigger], false)
    e.group()
    expect(e.isSourceConnected(source)).toBe(true)
    expect(e.isSourceConnected(load)).toBe(false)
    expect(e.isSourceConnected(trigger)).toBe(false)
  })
  it('recomputes copied islands while retaining copied sources and metadata changes', () => {
    const { e, a, b, bus } = network()
    e.select([b, bus], false)
    const island = [...e.duplicate()]
    expect(island.every((key) => !e.isSourceConnected(key))).toBe(true)
    e.select([a, b, bus], false)
    const supplied = [...e.duplicate()]
    expect(supplied.every((key) => e.isSourceConnected(key))).toBe(true)
    e.update(b, { id: 'renamed_breaker', amp_rating: 2000 })
    e.move(new Set([b]), 50, 50, false)
    e.rotate(new Set([b]))
    expect(e.isSourceConnected(b)).toBe(true)
    expect(island.every((key) => !e.isSourceConnected(key))).toBe(true)
  })
})
describe('Release-scale fixture', () => {
  it('validates exactly 2,000 equipment, 2,500 connectors, and four 500-tap buses', () => {
    const d = benchmarkDocument()
    expect(d.equipment).toHaveLength(2000)
    expect(d.connectors).toHaveLength(2500)
    validateDocument(d)
    const e = new Editor(d)
    for (let i = 0; i < 4; i++) expect(e.adjacency.get(`bench_${i}`)?.size).toBe(500)
  })
  it('moves and duplicates 1,000 items without the Gridventory operation cap', () => {
    const e = new Editor(benchmarkDocument())
    e.select([...e.equipment.keys()].slice(4, 1004))
    e.move(e.selection, 120, 100, false)
    e.duplicate()
    expect(e.equipment.size).toBe(3000)
    validateDocument(e.snapshot())
    e.undo()
    expect(e.equipment.size).toBe(2000)
    e.undo()
    validateDocument(e.snapshot())
  })
})
