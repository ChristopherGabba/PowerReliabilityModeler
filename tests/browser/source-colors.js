;(async () => {
  const previous = window.__COLOR_CHECK__ ?? window.__PSMTJ__
  const assert = (condition, message) => {
    if (!condition) throw new Error(message)
  }
  if (!window.__COLOR_CHECK__) {
    const selected = [...previous.editor.selection]
    assert(selected.length === 1000, 'Run measure.js before this check')
    for (const key of selected) {
      const view = previous.renderer.nodes.get(key)
      if (view?.symbol) assert(view.symbol.tint === 0x0088ff, 'Large selection lost its blue tint')
    }
  }
  const Renderer = previous.renderer.constructor
  const Controller = previous.controller.constructor
  await previous.session?.close()
  previous.controller.dispose()
  previous.renderer.dispose()
  const editor = new window.__PSMTJ_TEST__.Editor()
  const host = document.getElementById('canvas')
  const renderer = new Renderer(editor, host)
  const controller = new Controller(editor, host)
  const add = (type, id, x, y) => {
    const key = editor.add(type, { x, y })
    editor.update(key, { id })
    return key
  }
  const connect = (from, port, to, terminal) =>
    editor.connect({ equipment_key: from, port_id: port }, { equipment_key: to, port_id: terminal })
  const utility = add('utility_source', 'utility', -330, -240)
  const main = add('hv_breaker', 'utility_breaker', -330, -70)
  const load = add('load', 'utility_load', -330, 160)
  const generator = add('generator', 'generator', 330, -240)
  const genBreaker = add('hv_breaker', 'generator_breaker', 330, -70)
  const genLoad = add('load', 'generator_load', 330, 160)
  const spare = add('hv_breaker', 'spare_breaker', 0, -70)
  const spareLoad = add('load', 'spare_load', 0, 160)
  connect(utility, 'terminal', main, 'in')
  connect(main, 'out', load, 'terminal')
  connect(generator, 'terminal', genBreaker, 'in')
  connect(genBreaker, 'out', genLoad, 'terminal')
  connect(spare, 'out', spareLoad, 'terminal')
  editor.select([], false)
  await renderer.initialize()
  controller.fit()
  renderer.render()
  window.__COLOR_CHECK__ = { editor, renderer, controller }
  const checkPixels = (key, color) => {
    renderer.render()
    const item = editor.equipment.get(key)
    const preview = editor.preview
    const dx = preview?.kind === 'move' && preview.keys.has(key) ? preview.dx : 0
    const dy = preview?.kind === 'move' && preview.keys.has(key) ? preview.dy : 0
    const scale = renderer.app.canvas.width / host.clientWidth
    const zoom = editor.viewport.zoom
    const size = Math.floor(48 * zoom * scale)
    const x = Math.floor(((item.x + dx - 24) * zoom + editor.viewport.x) * scale)
    const y =
      renderer.app.canvas.height -
      Math.floor(((item.y + dy - 24) * zoom + editor.viewport.y) * scale) -
      size
    const pixels = new Uint8Array(size * size * 4)
    const context = renderer.app.canvas.getContext('webgl2')
    context.readPixels(x, y, size, size, context.RGBA, context.UNSIGNED_BYTE, pixels)
    const expected = [(color >> 16) & 255, (color >> 8) & 255, color & 255]
    let matches = 0,
      others = 0
    const observed = new Map()
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] < 64) continue
      if (
        expected.every(
          (value, channel) =>
            Math.abs(Math.round((value * pixels[i + 3]) / 255) - pixels[i + channel]) <= 2,
        )
      )
        matches++
      else {
        others++
        const rgb = Array.from(pixels.slice(i, i + 4)).join(',')
        observed.set(rgb, (observed.get(rgb) ?? 0) + 1)
      }
    }
    assert(
      matches > 3 && others === 0,
      `Unexpected ink pixels for ${key}: ${matches} correct, ${others} incorrect (${JSON.stringify([...observed])})`,
    )
  }
  checkPixels(main, 0x172334)
  checkPixels(genBreaker, 0x172334)
  checkPixels(spare, 0xb1bbc7)
  checkPixels(spareLoad, 0xb1bbc7)
  const extra = add('utility_source', 'temporary_source', 0, -240)
  connect(extra, 'terminal', spare, 'in')
  editor.select([], false)
  renderer.render()
  checkPixels(spare, 0x172334)
  editor.select([extra], false)
  editor.deleteSelection()
  renderer.render()
  checkPixels(spare, 0xb1bbc7)
  editor.undo()
  editor.select([], false)
  renderer.render()
  checkPixels(spare, 0x172334)
  editor.redo()
  editor.select([spare], false)
  renderer.render()
  checkPixels(spare, 0x0088ff)
  assert(renderer.overlay.context.instructions.length === 0, 'Selection box is still present')
  editor.preview = { kind: 'move', keys: editor.selection, dx: 45, dy: -30, duplicate: false }
  renderer.render()
  checkPixels(spare, 0x0088ff)
  assert(renderer.overlay.context.instructions.length === 0, 'Drag selection box is still present')
  const before = JSON.stringify(editor.snapshot())
  const canvas = renderer.app.canvas
  const gl = canvas.getContext('webgl2')
  const extension = gl.getExtension('WEBGL_lose_context')
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('GPU recovery timed out')), 5000)
    canvas.addEventListener(
      'webglcontextrestored',
      () => {
        clearTimeout(timeout)
        resolve()
      },
      { once: true },
    )
    canvas.addEventListener(
      'webglcontextlost',
      () => setTimeout(() => extension.restoreContext(), 150),
      { once: true },
    )
    extension.loseContext()
  })
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  renderer.render()
  checkPixels(spare, 0x0088ff)
  checkPixels(main, 0x172334)
  checkPixels(spareLoad, 0xb1bbc7)
  assert(before === JSON.stringify(editor.snapshot()), 'GPU recovery changed the model')
  document.getElementById('status').textContent =
    'Source-connected equipment · Disconnected equipment · Selected equipment'
  window.__COLOR_CHECK__ = { editor, renderer, controller }
  return {
    checked_at: new Date().toISOString(),
    passed: [
      'utility and generator connectivity',
      'disconnected island gray ink pixels',
      'connected equipment dark ink pixels',
      'connect/delete/undo updates colors',
      'blue selected ink pixels',
      '1,000 selected symbols stay blue',
      'no selection or drag box',
      'GPU recovery preserves colors and document',
    ],
  }
})()
