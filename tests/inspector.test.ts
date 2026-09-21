import { describe, expect, it } from 'vitest'
import { Editor } from '../src/core/editor'

describe('Following an open inspector', () => {
  it('stays closed until opened, then follows single selections, copies and undo without adding history', () => {
    const e = new Editor()
    const a = e.add('indoor_drawout_breaker', { x: 0, y: 0 })
    const b = e.add('dry_type_transformer', { x: 300, y: 0 })
    e.select([a])
    expect(e.inspector).toBeNull()
    e.inspector = a
    const revision = e.revision
    e.select([b])
    expect(e.inspector).toBe(b)
    expect(e.revision).toBe(revision)
    e.select([])
    expect(e.inspector).toBe(b)
    e.select([a])
    expect(e.inspector).toBe(a)
    const copy = [...e.duplicate()][0]
    expect(e.inspector).toBe(copy)
    e.undo()
    expect(e.inspector).toBe(a)
    e.redo()
    expect(e.inspector).toBe(copy)
    e.inspector = null
    e.select([b])
    expect(e.inspector).toBeNull()
  })
  it('can inspect another member of a selected group while keeping failover picking on its owner', () => {
    const e = new Editor()
    const a = e.add('indoor_drawout_breaker', { x: 0, y: 0 })
    const b = e.add('load', { x: 300, y: 0 })
    e.select([a, b])
    e.group()
    e.inspector = a
    e.followInspector(b)
    expect(e.inspector).toBe(b)
    expect(e.selection).toEqual(new Set([a, b]))
    e.startFailoverPick(b, 'triggers')
    e.followInspector(a)
    expect(e.inspector).toBe(b)
    e.cancel()
    e.selectConnector('test-connector')
    e.select([a], false)
    expect(e.inspector).toBe(a)
    expect(e.selectedConnector).toBeNull()
  })
})
