// Evaluate on /symbols.html: disposable editor and renderer, no persistence.
;(() => {
  const { editor: e, renderer: r, keys } = window.__SYMBOL_TEST__
  const owner = keys.find((key) => e.equipment.get(key).equipment_type === 'indoor_drawout_breaker')
  const trigger = keys.find((key) => e.equipment.get(key).equipment_type === 'utility_source')
  const target = keys.find((key) => e.equipment.get(key).equipment_type === 'generator')
  const originalViewport = { ...e.viewport }
  const item = e.equipment.get(owner)
  e.setViewport({ x: 400 - item.x * 2, y: 250 - item.y * 2, zoom: 2 })
  const assertColor = (key, expected) => {
    r.render()
    const strokes = r.nodes.get(key).lines.context.instructions.filter((i) => i.action === 'stroke')
    if (!strokes.length || strokes.some((i) => i.data.style.color !== expected))
      throw new Error(`Incorrect symbol color: expected ${expected.toString(16)}`)
  }
  e.setFailover(owner, [trigger], target)
  for (const selection of [[], [owner], [trigger], [target]]) {
    e.select(selection, false)
    assertColor(owner, 0xec4899)
    if (r.nodes.get(owner).label.style.fill !== 0xec4899)
      throw new Error('Failover owner label did not stay pink')
  }
  e.select([owner], false)
  assertColor(trigger, 0xe88724)
  e.preview = { kind: 'move', keys: e.selection, dx: 20, dy: 30, duplicate: false }
  assertColor(owner, 0xec4899)
  e.preview = null
  e.startFailoverPick(owner, 'triggers')
  assertColor(owner, 0xec4899)
  assertColor(trigger, 0x16a085)
  e.cancel()
  e.select([], false)
  e.removeFailover(owner)
  assertColor(owner, 0xb1bbc7)
  e.undo()
  assertColor(owner, 0xec4899)
  e.redo()
  assertColor(owner, 0xb1bbc7)
  e.undo()
  e.setViewport(originalViewport)
  r.render()
  return {
    passed: true,
    checks: ['persistent pink', 'selection', 'drag', 'picking', 'remove', 'undo/redo'],
  }
})()
