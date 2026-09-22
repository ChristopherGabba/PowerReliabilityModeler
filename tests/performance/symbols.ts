import { Editor } from '../../src/core/editor'
import { CATALOG } from '../../src/core/catalog'
import { EQUIPMENT_TYPES } from '../../src/core/types'
import { worldPoint } from '../../src/core/geometry'
import { CanvasRenderer } from '../../src/canvas/renderer'
import '@fontsource/geist/400.css'

// Disposable scene: no project session, database, or cloud writes.
const editor = new Editor()
const keys = EQUIPMENT_TYPES.map((type, i) => {
  const key = editor.add(type, { x: (i % 4) * 240, y: Math.floor(i / 4) * 190 })
  editor.update(key, { id: CATALOG[type].short.replaceAll(' ', '_') })
  return key
})
editor.select([], false)
editor.setViewport({ x: 160, y: 180, zoom: 1.55 })
const renderer = new CanvasRenderer(editor, document.getElementById('canvas') as HTMLDivElement)
await renderer.initialize()
renderer.render()
;(window as any).__SYMBOL_TEST__ = { editor, renderer, keys, CATALOG, worldPoint }
