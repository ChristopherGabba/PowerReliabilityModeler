import { describe, it, expect } from 'vitest'
import { Editor } from '../src/core/editor'
import { deratedMva, equipmentLabel } from '../src/core/labels'
import { exportModel } from '../src/core/schema'
import { equipmentBounds } from '../src/core/geometry'

describe('Private equipment labels', () => {
  it('defaults to the right while preserving legacy dragged positions and their copies', () => {
    const e = new Editor()
    const key = e.add('dry_type_transformer', { x: 100, y: 200 })
    e.measureLabel(key, 140, 60, true)
    const item = e.equipment.get(key)!,
      bounds = equipmentBounds(item)
    expect(e.labelPosition(item)).toEqual({ x: bounds.maxX + 8 + 70, y: 170 })
    e.loadLabelOffsets({ [key]: { x: 0, y: 0 } })
    expect(e.labelPosition(item)).toEqual({ x: bounds.maxX + 8 + 70, y: 170 })
    e.loadLabelOffsets({ [key]: { x: 120, y: -15 } })
    const legacyPosition = { x: 220, y: bounds.maxY + 3 - 15 }
    expect(e.labelPosition(item)).toEqual(legacyPosition)
    const copy = [...e.duplicate(400, 0)][0]
    expect(e.labelPosition(e.equipment.get(copy)!)).toEqual({ x: 620, y: legacyPosition.y })
    e.setLabelOffset(key, { x: 130, y: -10 })
    expect(e.labelPosition(item)).toEqual({ x: 230, y: legacyPosition.y + 5 })
    e.undo()
    expect(e.labelPosition(item)).toEqual(legacyPosition)
  })
  it('calculates derated three-phase MVA and distinguishes missing ratings from zero', () => {
    const editor = new Editor()
    const key = editor.add('hv_breaker', { x: 0, y: 0 })
    expect(deratedMva(editor.equipment.get(key)!)).toBeNull()
    editor.update(key, { kv_rating: 13.8, amp_rating: 1200, derating_multiplier: 0.99 })
    expect(deratedMva(editor.equipment.get(key)!)).toBeCloseTo(28.395933759607, 10)
    expect(equipmentLabel(editor.equipment.get(key)!)).toBe(
      'hv_breaker_1\n13.8 kV · 1,200 A\nDerating × 0.99\n28.396 MVA',
    )
    editor.update(key, { derating_multiplier: 0 })
    expect(deratedMva(editor.equipment.get(key)!)).toBe(0)
    editor.update(key, { amp_rating: null })
    expect(equipmentLabel(editor.equipment.get(key)!)).toContain('— MVA')
  })
  it('moves labels with independent history, without moving equipment or changing JSON/model revision', () => {
    const editor = new Editor()
    const key = editor.add('hv_breaker', { x: 10, y: 20 })
    const model = exportModel(editor.snapshot()),
      revision = editor.revision
    const patches: unknown[] = [],
      modelPatches: unknown[] = []
    editor.onLabelChange((patch) => patches.push(patch))
    editor.onChange((patch) => modelPatches.push(patch))
    const initial = editor.labelPosition(editor.equipment.get(key)!)
    editor.setLabelOffset(key, { x: 600, y: -100 })
    expect(editor.hitLabel({ x: initial.x + 600, y: initial.y - 100 + 5 })).toBe(key)
    expect(editor.hitLabel(initial)).toBeNull()
    expect(exportModel(editor.snapshot())).toEqual(model)
    expect(editor.revision).toBe(revision)
    editor.undo()
    expect(editor.labelPosition(editor.equipment.get(key)!)).toEqual(initial)
    editor.redo()
    expect(editor.labelOffsets.get(key)).toEqual({ x: 600, y: -100, anchor: 'right' })
    expect(patches).toHaveLength(3)
    expect(modelPatches).toHaveLength(0)
    expect(() => editor.setLabelOffset(key, { x: Infinity, y: 0 })).toThrow()
  })
  it('keeps offsets through renaming, rotation, movement, copying, deletion, and undo', () => {
    const editor = new Editor()
    const key = editor.add('hv_breaker', { x: 0, y: 0 })
    editor.setLabelOffset(key, { x: 100, y: -50 })
    editor.update(key, { id: 'main' })
    editor.rotate()
    const before = editor.labelPosition(editor.equipment.get(key)!)
    editor.move(new Set([key]), 300, 200)
    expect(editor.labelPosition(editor.equipment.get(key)!)).toEqual({
      x: before.x + 300,
      y: before.y + 200,
    })
    const copy = [...editor.duplicate()][0]
    expect(editor.labelOffsets.get(copy)).toEqual({ x: 100, y: -50, anchor: 'right' })
    editor.deleteSelection()
    expect(editor.hitLabel(editor.labelPosition(editor.equipment.get(key)!))).toBe(key)
    editor.undo()
    expect(editor.labelOffsets.get(copy)).toEqual({ x: 100, y: -50, anchor: 'right' })
    expect(
      exportModel(editor.snapshot()).equipment.every((item) => !('label_offset' in item)),
    ).toBe(true)
  })
})

describe('Selected failover triggers', () => {
  it('highlights trigger unions, excludes targets, and refreshes after selection, edits, deletion and undo', () => {
    const e = new Editor()
    const owner = e.add('hv_breaker', { x: 0, y: 0 })
    const trigger = e.add('utility_source', { x: 300, y: 0 })
    const target = e.add('generator', { x: 600, y: 0 })
    e.setFailover(owner, [trigger], target)
    e.select([owner])
    expect(e.isSelectedTrigger(trigger)).toBe(true)
    expect(e.isSelectedTrigger(target)).toBe(false)
    e.selectConnector('any')
    expect(e.isSelectedTrigger(trigger)).toBe(false)
    e.select([owner])
    e.setFailover(owner, [target], trigger)
    expect(e.isSelectedTrigger(trigger)).toBe(false)
    expect(e.isSelectedTrigger(target)).toBe(true)
    e.undo()
    expect(e.isSelectedTrigger(trigger)).toBe(true)
    e.select([trigger])
    e.deleteSelection()
    e.select([owner])
    expect(e.isSelectedTrigger(trigger)).toBe(false)
    e.undo()
    e.select([owner])
    expect(e.isSelectedTrigger(trigger)).toBe(true)
    e.setFailover(target, [owner], trigger)
    e.select([owner, target])
    expect(e.isSelectedTrigger(owner)).toBe(true)
    expect(e.isSelectedTrigger(trigger)).toBe(true)
  })
})
