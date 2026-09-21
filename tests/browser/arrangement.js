;(async () => {
  const {
    editor: e,
    session,
    keys,
    equipmentBounds,
    exportModel,
    importModel,
  } = window.__ARRANGEMENT_TEST__
  const assert = (value, message) => {
    if (!value) throw new Error(message)
  }
  const wait = () => new Promise(requestAnimationFrame)
  const button = (name) => document.querySelector(`button[aria-label="${name}"]`)
  const passed = []
  e.select(keys)
  await wait()
  for (const [action, edge, opposite] of [
    ['top', 'minY'],
    ['middle', 'minY', 'maxY'],
    ['bottom', 'maxY'],
    ['left', 'minX'],
    ['center', 'minX', 'maxX'],
    ['right', 'maxX'],
  ]) {
    e.move(new Set([keys[1]]), 137, 91, false)
    const before = e.snapshot(),
      bounds = e.selectionBounds(),
      target = opposite ? (bounds[edge] + bounds[opposite]) / 2 : bounds[edge]
    button('Align ' + action).click()
    await wait()
    for (const key of keys) {
      const b = equipmentBounds(e.equipment.get(key))
      assert(
        Math.abs((opposite ? (b[edge] + b[opposite]) / 2 : b[edge]) - target) < 1e-6,
        'Incorrect ' + action + ' alignment',
      )
    }
    assert(
      document.activeElement.matches('.canvas-host'),
      'Toolbar did not restore canvas shortcut focus',
    )
    const after = e.snapshot()
    e.undo()
    assert(JSON.stringify(e.snapshot()) === JSON.stringify(before), 'Undo failed for ' + action)
    e.redo()
    assert(JSON.stringify(e.snapshot()) === JSON.stringify(after), 'Redo failed for ' + action)
    e.undo()
    e.undo()
    await wait()
    passed.push('Align ' + action)
  }
  for (const direction of ['left to right', 'top to bottom']) {
    const horizontal = direction === 'left to right',
      min = horizontal ? 'minX' : 'minY',
      max = horizontal ? 'maxX' : 'maxY'
    e.move(new Set([keys[1]]), 137, 91, false)
    const before = e.snapshot()
    const order = keys
      .map((key) => ({ key, b: equipmentBounds(e.equipment.get(key)) }))
      .sort((a, b) => a.b[min] + a.b[max] - (b.b[min] + b.b[max]))
    button('Distribute evenly ' + direction).click()
    await wait()
    const bounds = order.map(({ key }) => equipmentBounds(e.equipment.get(key)))
    assert(
      Math.abs(bounds[1][min] - bounds[0][max] - (bounds[2][min] - bounds[1][max])) < 1e-6,
      'Uneven gaps ' + direction,
    )
    for (const index of [0, 2])
      assert(
        JSON.stringify(e.equipment.get(order[index].key)) ===
          JSON.stringify(before.equipment.find((item) => item.key === order[index].key)),
        'Outer item moved',
      )
    e.undo()
    assert(JSON.stringify(e.snapshot()) === JSON.stringify(before), 'Distribution undo failed')
    e.undo()
    await wait()
    passed.push('Distribute evenly ' + direction)
  }
  e.select(keys.slice(0, 2))
  await wait()
  assert(
    button('Distribute evenly left to right').disabled && !button('Align top').disabled,
    'Two-item controls incorrect',
  )
  e.select(keys)
  e.group()
  await wait()
  assert(
    [...document.querySelectorAll('.arrangement-controls button')].every(
      (button) => button.disabled,
    ),
    'A single group can be collapsed by alignment',
  )
  e.ungroup()
  await wait()
  assert(
    [...document.querySelectorAll('.arrangement-controls button')].every(
      (button) => !button.disabled,
    ),
    'Ungroup did not enable arrangement',
  )
  e.select([keys[0]])
  await wait()
  assert(
    !document.querySelector('.arrangement-controls'),
    'Arrangement controls visible for a single item',
  )
  e.select(keys)
  await wait()
  button('Align middle').click()
  await wait()
  button('Distribute evenly left to right').click()
  await wait()
  await session.worker.call('flush')
  const exported = JSON.parse(await session.export())
  assert(
    JSON.stringify(exported) === JSON.stringify(exportModel(e.snapshot())),
    'Autosaved/exported arrangement differs from canvas',
  )
  assert(
    JSON.stringify(exportModel(importModel(exported))) === JSON.stringify(exported),
    'Arrangement round trip lost model data',
  )
  passed.push(
    'selection and group availability',
    'canvas shortcut focus',
    'one-step undo/redo',
    'autosaved geometry',
    'JSON round trip',
  )
  return { checked_at: new Date().toISOString(), passed }
})()
