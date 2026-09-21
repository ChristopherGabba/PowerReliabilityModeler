import { Editor } from '../core/editor'
import { boundsOf, distance, endpointPosition, worldPoint } from '../core/geometry'
import { errorMessage, validateDocument } from '../core/schema'
import type { DocumentRecord, EndpointRecord, EquipmentType, Point, Viewport } from '../core/types'

type Gesture =
  | { kind: 'pan'; start: Point; viewport: Viewport }
  | { kind: 'label'; key: string; start: Point; offset: Point }
  | { kind: 'move'; start: Point; keys: Set<string>; duplicate: boolean }
  | { kind: 'marquee'; start: Point; existing: Set<string> }
  | { kind: 'wire'; from: EndpointRecord }
  | { kind: 'bus'; key: string; side: -1 | 1 }
  | { kind: 'bend'; id: string; index: number; points: Point[] }
export class CanvasController {
  private gesture: Gesture | null = null
  private paletteDrag: {
    type: EquipmentType
    pointerId: number
    source: HTMLElement
    start: Point
    active: boolean
  } | null = null
  private suppressPaletteClick = false
  private space = false
  private pendingMove: PointerEvent | null = null
  private frame = 0
  private wheelTimer: ReturnType<typeof setTimeout> | undefined
  private clipboard: DocumentRecord | null = null
  constructor(
    readonly editor: Editor,
    private host: HTMLDivElement,
  ) {
    host.addEventListener('pointerdown', this.down)
    host.addEventListener('pointermove', this.move)
    host.addEventListener('pointerup', this.up)
    host.addEventListener('pointercancel', this.cancel)
    host.addEventListener('dblclick', this.doubleClick)
    host.addEventListener('wheel', this.wheel, { passive: false })
    host.addEventListener('contextmenu', this.context)
    window.addEventListener('keydown', this.keydown)
    window.addEventListener('keyup', this.keyup)
    window.addEventListener('blur', this.cancel)
  }
  screen(event: { clientX: number; clientY: number }): Point {
    const r = this.host.getBoundingClientRect()
    return { x: event.clientX - r.left, y: event.clientY - r.top }
  }
  world(event: { clientX: number; clientY: number }): Point {
    const p = this.screen(event),
      v = this.editor.viewport
    return { x: (p.x - v.x) / v.zoom, y: (p.y - v.y) / v.zoom }
  }
  focus() {
    this.host.focus({ preventScroll: true })
  }
  selectPalette(type: EquipmentType, event: MouseEvent) {
    // Pointer capture sends the release click back to the palette button. Do not
    // re-arm placement after a completed/cancelled drag; keyboard clicks still work.
    if (event.detail > 0 && this.suppressPaletteClick) return
    this.editor.setTool('place', type)
    this.focus()
  }
  beginPaletteDrag(type: EquipmentType, event: PointerEvent, source: HTMLElement) {
    if (event.button !== 0 || !event.isPrimary || this.paletteDrag) return
    this.cancel()
    this.suppressPaletteClick = false
    this.paletteDrag = {
      type,
      pointerId: event.pointerId,
      source,
      start: { x: event.clientX, y: event.clientY },
      active: false,
    }
    event.preventDefault()
    this.focus()
    source.setPointerCapture(event.pointerId)
    window.addEventListener('pointermove', this.paletteMove)
    window.addEventListener('pointerup', this.paletteUp)
    window.addEventListener('pointercancel', this.paletteCancel)
    window.addEventListener('lostpointercapture', this.paletteCancel)
  }
  private palettePoint(event: PointerEvent): Point | null {
    // The palette and toolbars overlap the canvas rectangle, but are not drop targets.
    const target = document.elementFromPoint(event.clientX, event.clientY)
    return target && this.host.contains(target) ? this.world(event) : null
  }
  private paletteMove = (event: PointerEvent) => {
    const drag = this.paletteDrag
    if (!drag || drag.pointerId !== event.pointerId) return
    if (!drag.active) {
      if (Math.hypot(event.clientX - drag.start.x, event.clientY - drag.start.y) < 4) return
      drag.active = true
      this.suppressPaletteClick = true
    }
    this.editor.preview = { kind: 'place', type: drag.type, point: this.palettePoint(event) }
    this.editor.frame()
  }
  private clearPaletteDrag() {
    const drag = this.paletteDrag
    this.paletteDrag = null
    window.removeEventListener('pointermove', this.paletteMove)
    window.removeEventListener('pointerup', this.paletteUp)
    window.removeEventListener('pointercancel', this.paletteCancel)
    window.removeEventListener('lostpointercapture', this.paletteCancel)
    if (drag?.source.hasPointerCapture(drag.pointerId))
      drag.source.releasePointerCapture(drag.pointerId)
    if (this.editor.preview?.kind === 'place') this.editor.preview = null
    this.editor.frame()
  }
  private paletteUp = (event: PointerEvent) => {
    const drag = this.paletteDrag
    if (!drag || drag.pointerId !== event.pointerId) return
    const point = this.palettePoint(event)
    this.clearPaletteDrag()
    if (!drag.active || !point) return
    try {
      this.editor.add(drag.type, point)
      this.editor.setTool(event.shiftKey ? 'place' : 'select', drag.type)
    } catch (error) {
      this.editor.message(errorMessage(error))
    }
    this.focus()
  }
  private paletteCancel = (event: PointerEvent) => {
    if (this.paletteDrag?.pointerId !== event.pointerId) return
    this.suppressPaletteClick = true
    this.clearPaletteDrag()
  }
  private context = (event: MouseEvent) => {
    event.preventDefault()
    const hit =
      this.editor.hitLabel(this.world(event)) ?? this.editor.hitEquipment(this.world(event))
    if (hit) {
      this.editor.inspector = hit
      this.editor.select([hit])
    }
  }
  private down = (event: PointerEvent) => {
    if (event.button === 2) return
    event.preventDefault()
    this.focus()
    this.host.setPointerCapture(event.pointerId)
    const e = this.editor,
      p = this.world(event)
    if (event.button === 1 || this.space || e.tool === 'hand') {
      this.gesture = { kind: 'pan', start: this.screen(event), viewport: { ...e.viewport } }
      this.host.style.cursor = 'grabbing'
      return
    }
    if (e.tool === 'place') {
      e.add(e.placement, p)
      if (!event.shiftKey) e.setTool('select')
      return
    }
    const label = e.hitLabel(p)
    const hit = label ?? e.hitEquipment(p, 5 / e.viewport.zoom)
    if (e.failoverPick) {
      if (hit) e.pickFailover(hit)
      else this.gesture = { kind: 'marquee', start: p, existing: new Set(e.failoverPick.keys) }
      return
    }
    if (label) {
      e.select(event.shiftKey ? [...e.selection, label] : [label], false)
      e.followInspector(label)
      this.gesture = {
        kind: 'label',
        key: label,
        start: p,
        offset: e.labelOffsets.get(label) ?? { x: 0, y: 0 },
      }
      this.host.style.cursor = 'move'
      return
    }
    if (e.selection.size === 1) {
      const key = [...e.selection][0],
        item = e.equipment.get(key)!
      if (item.equipment_type === 'bus') {
        for (const side of [-1, 1] as const) {
          const handle = worldPoint(item, { x: (side * (item.bus_length ?? 200)) / 2, y: 0 })
          if (distance(handle, p) < 10 / e.viewport.zoom) {
            this.gesture = { kind: 'bus', key, side }
            return
          }
        }
      }
    }
    if (e.selectedConnector) {
      const c = e.connectors.get(e.selectedConnector)
      if (c)
        for (let i = 1; i < c.points.length; i++) {
          const a = c.points[i - 1],
            b = c.points[i]
          if (distance({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, p) < 9 / e.viewport.zoom) {
            this.gesture = { kind: 'bend', id: c.id, index: i, points: c.points }
            return
          }
        }
    }
    const terminal = e.nearestPort(p, new Set(), 8 / e.viewport.zoom)
    // Bus taps receive connections; pressing the bar selects and moves it.
    if (terminal && e.equipment.get(terminal.equipment_key)?.equipment_type !== 'bus') {
      this.gesture = { kind: 'wire', from: terminal }
      e.preview = { kind: 'wire', from: terminal, to: p }
      e.frame()
      return
    }
    if (hit) {
      const duplicate = event.altKey || ((event.ctrlKey || event.metaKey) && event.shiftKey)
      if (event.shiftKey && !duplicate) {
        const selection = new Set(e.selection)
        const members = e.expandGroups([hit])
        if (selection.has(hit)) for (const k of members) selection.delete(k)
        else for (const k of members) selection.add(k)
        e.select(selection, false)
      } else if (!e.selection.has(hit)) e.select([hit])
      e.followInspector(hit)
      this.gesture = { kind: 'move', start: p, keys: new Set(e.selection), duplicate }
      return
    }
    const connector = e.hitConnector(p, 7 / e.viewport.zoom)
    if (connector) {
      e.selectConnector(connector)
      return
    }
    this.gesture = {
      kind: 'marquee',
      start: p,
      existing: event.shiftKey ? new Set(e.selection) : new Set(),
    }
    if (!event.shiftKey) e.select([])
  }
  private move = (event: PointerEvent) => {
    this.pendingMove = event
    if (!this.frame)
      this.frame = requestAnimationFrame(() => {
        this.frame = 0
        const pending = this.pendingMove
        this.pendingMove = null
        if (pending) this.processMove(pending)
      })
  }
  private processMove(event: PointerEvent) {
    const e = this.editor,
      p = this.world(event),
      g = this.gesture
    e.pointer = p
    if (!g) {
      const hit = e.hitLabel(p) ?? e.hitEquipment(p, 5 / e.viewport.zoom)
      if (hit !== e.hover) {
        e.hover = hit
        e.frame()
      }
      this.host.style.cursor =
        e.tool === 'place'
          ? 'crosshair'
          : this.space || e.tool === 'hand'
            ? 'grab'
            : e.failoverPick
              ? 'crosshair'
              : hit
                ? 'move'
                : 'default'
      if (e.tool === 'place') e.frame()
      return
    }
    if (g.kind === 'pan') {
      const s = this.screen(event)
      e.setViewport({
        ...g.viewport,
        x: g.viewport.x + s.x - g.start.x,
        y: g.viewport.y + s.y - g.start.y,
      })
      e.frame(true)
      return
    }
    if (g.kind === 'label') {
      let dx = p.x - g.start.x,
        dy = p.y - g.start.y
      if (Math.hypot(dx, dy) * e.viewport.zoom < 3 && !e.preview) return
      if (event.shiftKey) {
        if (Math.abs(dx) > Math.abs(dy)) dy = 0
        else dx = 0
      }
      e.preview = { kind: 'label', key: g.key, offset: { x: g.offset.x + dx, y: g.offset.y + dy } }
    }
    if (g.kind === 'move') {
      let dx = p.x - g.start.x,
        dy = p.y - g.start.y
      if (Math.hypot(dx, dy) * e.viewport.zoom < 3 && !e.preview) return
      if (event.shiftKey && !((event.ctrlKey || event.metaKey) && event.shiftKey)) {
        if (Math.abs(dx) > Math.abs(dy)) dy = 0
        else dx = 0
      }
      const snap = g.duplicate ? null : e.findSnap(g.keys, dx, dy)
      if (snap && !event.shiftKey) {
        const a = endpointPosition(e.equipment.get(snap.from.equipment_key)!, snap.from),
          b = endpointPosition(e.equipment.get(snap.to.equipment_key)!, snap.to)
        dx = b.x - a.x
        dy = b.y - a.y
      }
      e.snap = snap
      e.preview = { kind: 'move', keys: g.keys, dx, dy, duplicate: g.duplicate }
    }
    if (g.kind === 'marquee') e.preview = { kind: 'marquee', bounds: boundsOf([g.start, p]) }
    if (g.kind === 'wire') {
      const target = e.nearestPort(p, new Set([g.from.equipment_key]), 16 / e.viewport.zoom)
      e.snap = target ? { from: g.from, to: target } : null
      e.preview = {
        kind: 'wire',
        from: g.from,
        to: target ? endpointPosition(e.equipment.get(target.equipment_key)!, target) : p,
      }
    }
    if (g.kind === 'bus')
      e.preview = { kind: 'bus', key: g.key, equipment: e.previewBus(g.key, g.side, p) }
    if (g.kind === 'bend') {
      const a = g.points[g.index - 1],
        b = g.points[g.index]
      const horizontal = Math.abs(a.y - b.y) < 0.01
      const before = horizontal ? { x: a.x, y: p.y } : { x: p.x, y: a.y }
      const after = horizontal ? { x: b.x, y: p.y } : { x: p.x, y: b.y }
      const bends = [
        ...g.points.slice(1, Math.max(1, g.index - 1)),
        before,
        after,
        ...g.points.slice(g.index + 1, -1),
      ]
      e.preview = { kind: 'bend', id: g.id, bends }
    }
    e.frame(true)
  }
  private up = (event: PointerEvent) => {
    if (this.pendingMove) {
      cancelAnimationFrame(this.frame)
      this.frame = 0
      this.pendingMove = null
      this.processMove(event)
    }
    const e = this.editor,
      g = this.gesture,
      preview = e.preview
    this.gesture = null
    try {
      if (g?.kind === 'pan') e.commitViewport()
      if (g?.kind === 'move' && preview?.kind === 'move') {
        if (g.duplicate) e.paste(e.copy(g.keys), preview.dx, preview.dy)
        else e.move(g.keys, preview.dx, preview.dy)
      }
      if (g?.kind === 'label' && preview?.kind === 'label') e.setLabelOffset(g.key, preview.offset)
      if (g?.kind === 'wire' && e.snap) e.connect(g.from, e.snap.to)
      if (g?.kind === 'marquee' && preview?.kind === 'marquee') {
        const keys = e.equipmentIndex.query(preview.bounds)
        if (e.failoverPick) {
          for (const key of keys) e.failoverPick.keys.add(key)
          e.notify()
        } else e.select([...g.existing, ...keys])
      }
      if (g?.kind === 'bus' && preview?.kind === 'bus') e.resizeBus(g.key, preview.equipment)
      if (g?.kind === 'bend' && preview?.kind === 'bend') e.setBends(g.id, preview.bends)
    } catch (error) {
      e.message(errorMessage(error))
    }
    e.preview = null
    e.snap = null
    e.frame()
    this.host.style.cursor = e.tool === 'hand' ? 'grab' : 'default'
    if (this.host.hasPointerCapture(event.pointerId))
      this.host.releasePointerCapture(event.pointerId)
  }
  private cancel = () => {
    if (this.paletteDrag) {
      this.suppressPaletteClick = true
      this.clearPaletteDrag()
    }
    this.gesture = null
    this.space = false
    this.pendingMove = null
    cancelAnimationFrame(this.frame)
    this.frame = 0
    this.editor.preview = null
    this.editor.snap = null
    this.editor.frame()
  }
  private doubleClick = (event: MouseEvent) => {
    const key =
      this.editor.hitLabel(this.world(event)) ?? this.editor.hitEquipment(this.world(event))
    if (key && !this.editor.failoverPick) {
      this.editor.inspector = key
      this.editor.select([key], false)
    }
  }
  private wheel = (event: WheelEvent) => {
    event.preventDefault()
    const e = this.editor,
      v = e.viewport,
      p = this.screen(event)
    if (event.ctrlKey || event.metaKey) {
      const zoom = Math.max(0.02, Math.min(8, v.zoom * Math.exp(-event.deltaY * 0.008)))
      e.setViewport({
        zoom,
        x: p.x - ((p.x - v.x) * zoom) / v.zoom,
        y: p.y - ((p.y - v.y) * zoom) / v.zoom,
      })
    } else e.setViewport({ ...v, x: v.x - event.deltaX, y: v.y - event.deltaY })
    clearTimeout(this.wheelTimer)
    this.wheelTimer = setTimeout(() => e.commitViewport(), 180)
  }
  zoom(factor: number) {
    const e = this.editor,
      v = e.viewport,
      p = { x: this.host.clientWidth / 2, y: this.host.clientHeight / 2 }
    const zoom = Math.max(0.02, Math.min(8, v.zoom * factor))
    e.setViewport(
      { zoom, x: p.x - ((p.x - v.x) * zoom) / v.zoom, y: p.y - ((p.y - v.y) * zoom) / v.zoom },
      true,
    )
  }
  fit() {
    const e = this.editor,
      b = e.selectionBounds(new Set(e.equipment.keys()), true)
    if (!b) {
      e.setViewport({ x: this.host.clientWidth / 2, y: this.host.clientHeight / 2, zoom: 1 }, true)
      return
    }
    const padding = 120,
      w = this.host.clientWidth,
      h = this.host.clientHeight
    const zoom = Math.max(
      0.02,
      Math.min(
        1.4,
        (w - padding * 2) / (b.maxX - b.minX || 1),
        (h - padding * 2) / (b.maxY - b.minY || 1),
      ),
    )
    e.setViewport(
      {
        zoom,
        x: w / 2 - ((b.minX + b.maxX) / 2) * zoom,
        y: h / 2 - ((b.minY + b.maxY) / 2) * zoom,
      },
      true,
    )
  }
  private keydown = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement
    if (target?.closest('input,textarea,select,[contenteditable="true"],[role="dialog"]')) return
    if (document.activeElement !== this.host && !this.host.contains(document.activeElement)) return
    const e = this.editor,
      mod = event.ctrlKey || event.metaKey,
      key = event.key.toLowerCase()
    let handled = true
    try {
      if (event.code === 'Space') {
        this.space = true
        this.host.style.cursor = 'grab'
      } else if (key === 'escape') {
        this.cancel()
        e.cancel()
        e.setTool('select')
      } else if (mod && key === 'z') {
        this.cancel()
        event.shiftKey ? e.redo() : e.undo()
      } else if (mod && key === 'y') {
        this.cancel()
        e.redo()
      } else if (mod && key === 'a') e.select(e.equipment.keys())
      else if (mod && key === 'd') e.duplicate()
      else if (event.ctrlKey && key === 'r') e.rotate()
      else if (mod && key === 'g') event.shiftKey ? e.ungroup() : e.group()
      else if (key === 'delete' || key === 'backspace') e.deleteSelection()
      else if (mod && key === 'c') {
        this.clipboard = e.copy()
        void navigator.clipboard
          ?.writeText(`PowerSystemsModelToJSON_CLIPBOARD\n${JSON.stringify(this.clipboard)}`)
          .catch(() => {})
      } else if (mod && key === 'v') {
        void this.paste()
      } else if (!mod && key === 'v') e.setTool('select')
      else if (!mod && key === 'h') e.setTool('hand')
      else if (key === 'f') this.fit()
      else if (key === '+' || key === '=') this.zoom(1.2)
      else if (key === '-') this.zoom(1 / 1.2)
      else handled = false
    } catch (error) {
      e.message(errorMessage(error))
    }
    if (handled) event.preventDefault()
  }
  private async paste() {
    try {
      let value = this.clipboard
      try {
        const text = await navigator.clipboard.readText()
        const prefix = ['PowerSystemsModelToJSON_CLIPBOARD\n', 'PRM_CLIPBOARD\n'].find((value) =>
          text.startsWith(value),
        )
        if (prefix) value = validateDocument(JSON.parse(text.slice(prefix.length)))
      } catch {}
      if (value) this.editor.paste(value)
      else this.editor.message('Copy equipment first, or import a model JSON file.')
    } catch (error) {
      this.editor.message(errorMessage(error))
    }
  }
  private keyup = (event: KeyboardEvent) => {
    if (event.code === 'Space') {
      this.space = false
      this.host.style.cursor = 'default'
    }
  }
  dispose() {
    this.cancel()
    clearTimeout(this.wheelTimer)
    this.host.removeEventListener('pointerdown', this.down)
    this.host.removeEventListener('pointermove', this.move)
    this.host.removeEventListener('pointerup', this.up)
    this.host.removeEventListener('pointercancel', this.cancel)
    this.host.removeEventListener('dblclick', this.doubleClick)
    this.host.removeEventListener('wheel', this.wheel)
    this.host.removeEventListener('contextmenu', this.context)
    window.removeEventListener('keydown', this.keydown)
    window.removeEventListener('keyup', this.keyup)
    window.removeEventListener('blur', this.cancel)
  }
}
