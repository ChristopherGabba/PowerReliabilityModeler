import { ApiError } from '../../src/persistence/api'
import { exportModel, importModel } from '../../src/core/schema'
import { database, loadLocal, removeLocal } from '../../src/persistence/local'
import { Editor } from '../../src/core/editor'
import { benchmarkDocument } from '../../src/core/fixtures'
import { CanvasRenderer } from '../../src/canvas/renderer'
import { CanvasController } from '../../src/canvas/controller'
import { ProjectSession } from '../../src/persistence/session'
import { emptyDocument, uid } from '../../src/core/types'
import '@fontsource/geist/400.css'
const status = document.getElementById('status')!
async function start() {
  const t = performance.now(),
    host = document.getElementById('canvas') as HTMLDivElement,
    editor = new Editor(benchmarkDocument()),
    session = new ProjectSession(uid(), 'benchmark', null, () => {})
  await session.open(undefined, editor.snapshot())
  session.attach(editor)
  const renderer = new CanvasRenderer(editor, host),
    controller = new CanvasController(editor, host)
  await renderer.initialize(
    new URLSearchParams(location.search).get('renderer') === 'webgpu' ? 'webgpu' : 'webgl',
  )
  controller.fit()
  renderer.render()
  ;(window as any).__PSMTJ__ = {
    editor,
    renderer,
    controller,
    session,
    openMs: performance.now() - t,
  }
  status.textContent = `${renderer.metrics.backend} · 2,000 equipment · 2,500 connectors · four 500-tap buses · production renderer`
  controller.focus()
}
void start().catch((error) => {
  status.textContent = String(error)
})

;(window as any).__PSMTJ_TEST__ = {
  ProjectSession,
  Editor,
  emptyDocument,
  uid,
  ApiError,
  exportModel,
  importModel,
  database,
  loadLocal,
  removeLocal,
}
