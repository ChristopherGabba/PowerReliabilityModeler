// Evaluate on /symbols.html from the benchmark Vite server. The scene has no persistence.
;(() => {
  const { editor: e, renderer: r, keys, CATALOG, worldPoint } = window.__SYMBOL_TEST__
  const assert = (condition, message) => {
    if (!condition) throw new Error(message)
  }
  const originalViewport = { ...e.viewport }
  const canvas = r.app.canvas
  const gl = canvas.getContext('webgl2')
  const resolution = r.app.renderer.resolution
  const widthAt = (point, direction) => {
    const scale = e.viewport.zoom * resolution
    const x = Math.floor((point.x * e.viewport.zoom + e.viewport.x) * resolution)
    const y = Math.floor((point.y * e.viewport.zoom + e.viewport.y) * resolution)
    const horizontal = Math.abs(direction.x) > Math.abs(direction.y)
    const span = Math.ceil(4 * scale)
    const pixels = new Uint8Array((2 * span + 1) * 4)
    gl.readPixels(
      horizontal ? x : x - span,
      canvas.height - 1 - y - (horizontal ? span : 0),
      horizontal ? 1 : 2 * span + 1,
      horizontal ? 2 * span + 1 : 1,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      pixels,
    )
    let coverage = 0
    for (let i = 3; i < pixels.length; i += 4) coverage += pixels[i] / 255
    return coverage / scale
  }
  let samples = 0
  let maximumError = 0
  for (const zoom of [1, 2, 3]) {
    for (const selected of [false, true]) {
      for (const key of keys) {
        const original = e.equipment.get(key)
        for (const rotation of [0, 90, 180, 270]) {
          e.update(key, { rotation })
          const item = e.equipment.get(key)
          e.select(selected ? [key] : [], false)
          e.setViewport({
            x: canvas.clientWidth / 2 - item.x * zoom,
            y: canvas.clientHeight / 2 - item.y * zoom,
            zoom,
          })
          r.render()
          const checks = CATALOG[item.equipment_type].ports.flatMap((port) => {
            // The selected output's terminal ring covers this entire short lead.
            if (item.equipment_type === 'ring_main_unit' && port.dy === 1 && selected) return []
            const depths =
              item.equipment_type === 'disconnect_switch'
                ? [6, 8, 12, 15]
                : item.equipment_type === 'indoor_drawout_breaker'
                  ? [13]
                  : item.equipment_type === 'ring_main_unit'
                    ? [port.dy === 1 ? 3 : 8]
                    : [6]
            return depths.map((depth) => ({
              point: { x: port.x - port.dx * depth, y: port.y - port.dy * depth },
              direction: { x: port.dx, y: port.dy },
            }))
          })
          if (item.equipment_type === 'outdoor_mv_hv_breaker')
            checks.push({ point: { x: -11.5, y: 0 }, direction: { x: 0, y: 1 } })
          if (item.equipment_type === 'ring_main_unit')
            checks.push({ point: { x: -45, y: -25 }, direction: { x: 0, y: 1 } })
          if (item.equipment_type === 'bus')
            checks.push({ point: { x: 0, y: 0 }, direction: { x: 1, y: 0 } })
          for (const check of checks) {
            const point = worldPoint(item, check.point)
            const vector = worldPoint({ ...item, x: 0, y: 0 }, check.direction)
            const measured = widthAt(point, vector)
            const expected = item.equipment_type === 'bus' ? 2.8 : 1.4
            const error = Math.abs(measured - expected)
            maximumError = Math.max(maximumError, error)
            assert(
              error <= 0.4,
              `${item.equipment_type} rotation=${rotation} zoom=${zoom} selected=${selected}: line is ${measured.toFixed(2)}, expected ${expected} at ${JSON.stringify(check.point)}`,
            )
            samples++
          }
        }
        e.update(key, { rotation: original.rotation })
      }
    }
  }
  // Connected and selected wires must meet the same complete leads without a cap bulge.
  const source = e.equipment.get(keys[2])
  const disconnectKey = e.add('disconnect_switch', { x: source.x, y: source.y + 130 })
  const wire = e.connect(
    { equipment_key: source.key, port_id: 'out' },
    { equipment_key: disconnectKey, port_id: 'in' },
  )
  assert(wire, 'Could not connect disposable test equipment')
  e.select([], false)
  e.setViewport({ x: canvas.clientWidth / 2 - source.x * 3, y: 200 - source.y * 3, zoom: 3 })
  for (const selected of [false, true]) {
    if (selected) e.selectConnector(wire)
    else e.select([], false)
    r.render()
    for (const offset of [38, 39, 40, 41, 42, 50, 98, 99, 100, 101, 102]) {
      const measured = widthAt({ x: source.x, y: source.y + offset }, { x: 0, y: 1 })
      assert(
        Math.abs(measured - 1.4) <= 0.4,
        `Wire/terminal seam widened to ${measured.toFixed(2)} at ${offset}`,
      )
      samples++
    }
  }
  e.undo()
  e.undo()
  e.select([], false)
  e.setViewport(originalViewport)
  r.render()
  return {
    passed: true,
    samples,
    maximumError: Number(maximumError.toFixed(3)),
    zooms: [1, 2, 3],
    rotations: [0, 90, 180, 270],
  }
})()
