import { describe, expect, it } from 'vitest'
import { Editor } from '../src/core/editor'
import { applyPatch } from '../src/core/schema'

function fixture() {
  const e = new Editor()
  const owner = e.add('indoor_drawout_breaker', { x: 0, y: 0 })
  const a = e.add('utility_source', { x: 300, y: 0 })
  const b = e.add('load', { x: 600, y: 0 })
  const target = e.add('generator', { x: 900, y: 0 })
  e.setFailover(owner, [], target)
  e.startFailoverPick(owner, 'triggers')
  return {
    e,
    owner,
    a,
    b,
    target,
    definition: () => e.failovers.find((f) => f.equipment_key === owner)!,
  }
}

describe('Immediate failover selection', () => {
  it('saves each click through normal persistence patches, and stopping retains the choices', () => {
    const { e, owner, a, b, target, definition } = fixture()
    let saved = e.snapshot()
    e.onChange((patch) => {
      saved = applyPatch(saved, patch)
    })
    e.pickFailover(a)
    expect(definition()).toEqual({ equipment_key: owner, trigger_keys: [a], parent_key: target })
    expect(saved.failovers).toEqual(e.failovers)
    expect(e.failoverPick?.keys).toEqual(new Set([a]))
    expect(e.inspector).toBe(owner)
    e.pickFailover(b)
    expect(definition().trigger_keys).toEqual([a, b])
    e.pickFailover(a)
    expect(definition().trigger_keys).toEqual([b])
    e.stopFailoverPick()
    expect(e.failoverPick).toBeNull()
    expect(new Editor(saved).failovers).toEqual(e.failovers)
    e.undo()
    expect(definition().trigger_keys).toEqual([a, b])
    e.redo()
    expect(definition().trigger_keys).toEqual([b])
  })

  it('adds a whole box selection in one undo step and ignores duplicate or empty additions', () => {
    const { e, a, b, definition } = fixture()
    const before = e.revision
    e.addFailoverTriggers([a, b, a])
    expect(e.revision).toBe(before + 1)
    expect(definition().trigger_keys).toEqual([a, b])
    e.addFailoverTriggers([a, b])
    e.addFailoverTriggers([])
    expect(e.revision).toBe(before + 1)
    e.undo()
    expect(definition().trigger_keys).toEqual([])
    expect(e.failoverPick?.keys.size).toBe(0)
    e.redo()
    expect(e.failoverPick?.keys).toEqual(new Set([a, b]))
  })

  it('keeps live highlights in sync with sidebar removal, undo, and subsequent picks', () => {
    const { e, owner, a, b, target, definition } = fixture()
    e.addFailoverTriggers([a, b])
    e.setFailover(owner, [b], target)
    expect(e.failoverPick?.keys).toEqual(new Set([b]))
    e.pickFailover(a)
    expect(definition().trigger_keys).toEqual([b, a])
    e.undo()
    expect(e.failoverPick?.keys).toEqual(new Set([b]))
    e.pickFailover(b)
    expect(definition().trigger_keys).toEqual([])
    e.undo()
    expect(e.failoverPick?.keys).toEqual(new Set([b]))
    e.removeFailover(owner)
    expect(e.failoverPick).toBeNull()
    expect(e.failovers).toEqual([])
  })

  it('saves a picked target immediately and exits, while rejecting the owner as its own target', () => {
    const { e, owner, a, b, target, definition } = fixture()
    e.pickFailover(a)
    e.startFailoverPick(owner, 'parent')
    e.pickFailover(owner)
    expect(e.failoverPick?.kind).toBe('parent')
    expect(definition().parent_key).toBe(target)
    e.addFailoverTriggers([b])
    expect(definition().trigger_keys).toEqual([a])
    e.pickFailover(b)
    expect(e.failoverPick).toBeNull()
    expect(definition()).toEqual({ equipment_key: owner, trigger_keys: [a], parent_key: b })
    e.undo()
    expect(definition().parent_key).toBe(target)
    e.redo()
    expect(definition().parent_key).toBe(b)
  })

  it('keeps saved picks when escaping or switching tools, and never creates a definition just by entering', () => {
    const { e, owner, a, definition } = fixture()
    e.pickFailover(a)
    e.setTool('hand')
    expect(e.failoverPick).toBeNull()
    expect(definition().trigger_keys).toEqual([a])
    const revision = e.revision
    e.startFailoverPick(a, 'triggers')
    e.stopFailoverPick()
    expect(e.failovers.map((f) => f.equipment_key)).toEqual([owner])
    expect(e.revision).toBe(revision)
  })

  it('ends selection if its owner is deleted or another component is inspected', () => {
    const { e, owner, a } = fixture()
    e.pickFailover(a)
    e.inspector = a
    e.select([a], false)
    expect(e.failoverPick).toBeNull()
    e.startFailoverPick(owner, 'triggers')
    e.deleteSelection()
    expect(e.failoverPick).toBeNull()
    expect(e.failovers).toEqual([])
  })
})
