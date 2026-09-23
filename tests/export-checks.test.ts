import { describe, expect, it } from 'vitest'
import { Editor } from '../src/core/editor'
import { exportIssues } from '../src/core/exportChecks'
import { exportModel, importModel, validateDocument } from '../src/core/schema'
import { EQUIPMENT_TYPES } from '../src/core/types'

describe('Pre-export checks', () => {
  it.each(EQUIPMENT_TYPES)(
    'requires voltage and current for %s without changing drafts',
    (type) => {
      const e = new Editor()
      const key = e.add(type, { x: 0, y: 0 })
      const original = e.snapshot()
      expect(validateDocument(original)).toEqual(original)
      expect(exportIssues(original)).toEqual([
        { key, id: e.equipment.get(key)!.id, message: 'Missing voltage (kV) and current (A)' },
      ])
      expect(() => exportModel(original)).toThrow('Missing voltage (kV) and current (A)')
      expect(e.snapshot()).toEqual(original)
      e.update(key, { kv_rating: 13.8 })
      expect(() => exportModel(e.snapshot())).toThrow('Missing current (A)')
      e.update(key, { kv_rating: null, amp_rating: 1200 })
      expect(() => exportModel(e.snapshot())).toThrow('Missing voltage (kV)')
      e.update(key, { kv_rating: 0, amp_rating: 0 })
      expect(exportIssues(e.snapshot())).toEqual([])
      expect(exportModel(e.snapshot()).equipment[0]).toMatchObject({ kv_rating: 0, amp_rating: 0 })
    },
  )

  it('reports every affected equipment ID, including an incomplete failover owner', () => {
    const e = new Editor()
    const source = e.add('utility_source', { x: 0, y: 0 })
    const load = e.add('load', { x: 200, y: 200 })
    e.update(source, { id: 'utility_north', kv_rating: 13.8 })
    e.update(load, { id: 'load_west', kv_rating: 0.48, amp_rating: 200 })
    e.setFailover(load, [source], null)
    expect(exportIssues(e.snapshot())).toEqual([
      { key: source, id: 'utility_north', message: 'Missing current (A)' },
      { key: load, id: 'load_west', message: 'Complete or remove the failover' },
    ])
  })

  it('keeps groups in saved documents, accepts older groups and missing ratings, and omits groups from downloads', () => {
    const e = new Editor()
    const keys = [e.add('utility_source', { x: 0, y: 0 }), e.add('load', { x: 0, y: 200 })]
    for (const key of keys) e.update(key, { kv_rating: 13.8, amp_rating: 1200 })
    e.connect(
      { equipment_key: keys[0], port_id: 'terminal' },
      { equipment_key: keys[1], port_id: 'terminal' },
    )
    e.select(keys)
    e.group()
    const saved = e.snapshot()
    const file = exportModel(saved)
    expect(file).not.toHaveProperty('groups')
    expect(validateDocument(saved).groups).toHaveLength(1)
    expect(e.snapshot()).toEqual(saved)
    expect(importModel(file).groups).toEqual([])
    const legacy = {
      ...file,
      groups: [{ id: 'old-group', equipment_ids: file.equipment.map((item) => item.id) }],
    }
    legacy.equipment[0].kv_rating = null
    const imported = importModel(legacy)
    expect(imported.groups).toHaveLength(1)
    expect(
      imported.equipment.find((item) => item.id === legacy.equipment[0].id)!.kv_rating,
    ).toBeNull()
    expect(() => exportModel(imported)).toThrow('Missing voltage')
    const corrected = new Editor(imported)
    corrected.update(imported.equipment.find((item) => item.kv_rating === null)!.key, {
      kv_rating: 13.8,
    })
    expect(exportModel(corrected.snapshot())).not.toHaveProperty('groups')
    expect(() =>
      importModel({ ...legacy, groups: [{ id: 'bad', equipment_ids: ['missing', 'load_1'] }] }),
    ).toThrow('Missing equipment')
  })
})
