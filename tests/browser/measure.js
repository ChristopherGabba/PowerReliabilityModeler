;(async () => {
  const { editor: e, renderer: r } = window.__PSMTJ__
  const frames = async (action, count = 90) => {
    const elapsed = []
    for (let i = 0; i < count; i++) {
      await new Promise(requestAnimationFrame)
      const t = performance.now()
      action(i)
      r.render()
      elapsed.push(performance.now() - t)
    }
    const sorted = [...elapsed].sort((a, b) => a - b)
    return {
      p50: sorted[Math.floor(count * 0.5)],
      p95: sorted[Math.floor(count * 0.95)],
      max: sorted.at(-1),
    }
  }
  const initial = { ...e.viewport }
  const pan = await frames((i) => {
    e.viewport = { ...initial, x: initial.x + Math.sin(i / 12) * 100 }
  })
  e.select([...e.equipment.keys()].slice(4, 1004))
  const keys = e.selection
  const move = await frames((i) => {
    e.preview = { kind: 'move', keys, dx: i * 2, dy: i, duplicate: false }
  })
  e.preview = null
  r.render()
  const start = performance.now()
  e.duplicate()
  const duplicateMs = performance.now() - start
  r.render()
  e.undo()
  r.render()
  await new Promise(requestAnimationFrame)
  await new Promise((resolve) => setTimeout(resolve, 100))
  const longs = []
  const observer = new PerformanceObserver((list) =>
    longs.push(...list.getEntries().map((v) => ({ duration: v.duration, startTime: v.startTime }))),
  )
  observer.observe({ type: 'longtask' })
  e.move(keys, 1, 0, false)
  const saveResult = await Promise.race([
    window.__PSMTJ__.session.worker
      .call('flush')
      .then(() => window.__PSMTJ__.session.sync())
      .then(() => true),
    new Promise((resolve) => setTimeout(() => resolve('timeout'), 5000)),
  ])
  await new Promise(requestAnimationFrame)
  observer.disconnect()
  const gl = r.app.renderer.gl
  const ext = gl?.getExtension('WEBGL_debug_renderer_info')
  const result = {
    userAgent: navigator.userAgent,
    gpu: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : r.metrics.backend,
    viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
    openMs: window.__PSMTJ__.openMs,
    items: e.equipment.size,
    connectors: e.connectors.size,
    pan,
    move,
    duplicateMs,
    saveResult,
    saveLongTasks: longs,
    memory: performance.memory?.usedJSHeapSize,
  }
  window.__PSMTJ_RESULT__ = result
  return result
})()
