import { Application, BitmapText, Container, Graphics } from 'pixi.js'
import { CATALOG } from '../core/catalog'
import { equipmentLabel } from '../core/labels'
import { Editor } from '../core/editor'
import { drawEquipmentSymbol } from './equipmentSymbol'
import { DIAGRAM_STROKE_WIDTH } from '../core/symbols'
import {
  endpointPosition,
  equipmentBounds,
  routeConnector,
  translateConnector,
  worldPoint,
} from '../core/geometry'
import type { ConnectorRecord, EquipmentRecord, Point } from '../core/types'

type NodeView = {
  root: Container
  body: Container
  lines: Graphics
  label: BitmapText
  targetMarker: Graphics | null
  labelRecord: EquipmentRecord | null
  labelDetails: boolean
  record: EquipmentRecord | null
  state: string
}
type EdgeView = { graphics: Graphics; record: ConnectorRecord | null; color: number }
const blue = 0x0088ff,
  pink = 0xec4899,
  purple = 0x7c3aed,
  ink = 0x172334,
  disconnected = 0xb1bbc7

export class CanvasRenderer {
  readonly app = new Application()
  readonly world = new Container({ isRenderGroup: true })
  private wires = new Container()
  private nodesLayer = new Container()
  private moving = new Container({ isRenderGroup: true })
  private overlay = new Graphics()
  private ghost = new Container()
  private placementGhost: NodeView | null = null
  private nodes = new Map<string, NodeView>()
  private edges = new Map<string, EdgeView>()
  private frameId = 0
  private disposed = false
  private observer: ResizeObserver | undefined
  private unsubscribe: () => void = () => {}
  private movingKeys: Set<string> | null = null
  private movingEdges = new Set<string>()
  private boundaryEdges = new Set<string>()
  private ghostViews: NodeView[] = []
  private ghostEdges: Graphics[] = []
  private movingDuplicate = false
  private lastGrid = ''
  metrics = {
    frames: 0,
    renderMs: [] as number[],
    visibleEquipment: 0,
    visibleConnectors: 0,
    backend: 'WebGL2',
  }
  constructor(
    readonly editor: Editor,
    private host: HTMLDivElement,
  ) {}
  async initialize(preference: 'webgl' | 'webgpu' = 'webgl') {
    // Load the web font before Pixi creates its shared bitmap glyph atlas.
    await document.fonts.load('11px Geist').catch(() => undefined)
    if (this.disposed) return
    await this.app.init({
      preference,
      preferWebGLVersion: 2,
      autoStart: false,
      sharedTicker: false,
      antialias: true,
      backgroundAlpha: 0,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
      width: this.host.clientWidth,
      height: this.host.clientHeight,
    })
    if (this.disposed) {
      this.app.destroy(true, { children: true })
      return
    }
    this.metrics.backend = preference === 'webgpu' ? 'WebGPU' : 'WebGL2'
    this.app.stage.eventMode = 'none'
    this.app.stage.addChild(this.world)
    this.world.addChild(this.wires, this.nodesLayer, this.moving, this.ghost, this.overlay)
    this.app.canvas.setAttribute('aria-hidden', 'true')
    this.host.appendChild(this.app.canvas)
    this.app.canvas.addEventListener('webglcontextlost', this.contextLost)
    this.app.canvas.addEventListener('webglcontextrestored', this.contextRestored)
    this.unsubscribe = this.editor.onFrame(this.request)
    this.observer = new ResizeObserver(() => {
      this.app.renderer.resize(this.host.clientWidth, this.host.clientHeight)
      this.request()
    })
    this.observer.observe(this.host)
    this.request()
  }

  private contextLost = (event: Event) => {
    event.preventDefault()
    this.editor.message('Graphics paused. Your model is retained while the canvas reconnects.')
  }
  private contextRestored = () => {
    for (const v of this.nodes.values()) v.record = null
    for (const v of this.edges.values()) v.record = null
    this.editor.message('Canvas restored.')
    this.request()
  }
  request = (immediate = false) => {
    // Pointer processing already runs inside an animation frame. Render in that
    // frame instead of adding another frame of input latency.
    if (immediate && !this.disposed) {
      cancelAnimationFrame(this.frameId)
      this.frameId = 0
      this.render()
      return
    }
    if (!this.frameId && !this.disposed)
      this.frameId = requestAnimationFrame(() => {
        this.frameId = 0
        this.render()
      })
  }
  private makeNode(): NodeView {
    const root = new Container(),
      body = new Container(),
      lines = new Graphics()
    const label = new BitmapText({
      text: '',
      style: { fontFamily: 'Geist', fontSize: 11, lineHeight: 15, align: 'center', fill: 0x526074 },
    })
    label.anchor.set(0.5, 0)
    root.addChild(body, label)
    body.addChild(lines)
    return {
      root,
      body,
      lines,
      label,
      targetMarker: null,
      labelRecord: null,
      labelDetails: false,
      record: null,
      state: '',
    }
  }
  private updateLabel(v: NodeView, e: EquipmentRecord) {
    const details = this.editor.viewport.zoom >= 0.65
    const old = v.labelRecord
    if (
      !old ||
      old.id !== e.id ||
      old.kv_rating !== e.kv_rating ||
      old.amp_rating !== e.amp_rating ||
      old.derating_multiplier !== e.derating_multiplier ||
      v.labelDetails !== details
    ) {
      v.label.text = equipmentLabel(e, details)
      v.labelDetails = details
      this.editor.measureLabel(e.key, v.label.width, v.label.height, details)
    }
    v.labelRecord = e
    const position = this.editor.labelPosition(e)
    const preview = this.editor.preview
    if (preview?.kind === 'label' && preview.key === e.key) {
      const previous = this.editor.labelOffsets.get(e.key) ?? { x: 0, y: 0 }
      position.x += preview.offset.x - previous.x
      position.y += preview.offset.y - previous.y
    }
    v.label.position.set(position.x - e.x, position.y - e.y)
    v.label.visible = this.editor.viewport.zoom > 0.38
  }
  private updateNode(v: NodeView, e: EquipmentRecord, force = false) {
    this.updateLabel(v, e)
    const pick = this.editor.failoverPick
    const selected = this.editor.selection.has(e.key)
    const connected = this.editor.isSourceConnected(e.key)
    const trigger = this.editor.isSelectedTrigger(e.key)
    const target = this.editor.isSelectedTarget(e.key)
    const hasFailover = this.editor.hasFailoverLinks(e.key)
    const terminals =
      (selected && this.editor.selection.size <= 50) || this.editor.hover === e.key || !!pick
    const state = `${selected}:${connected}:${trigger}:${target}:${hasFailover}:${terminals}:${pick?.keys.has(e.key)}:${pick?.owner === e.key}`
    if (v.record === e && v.state === state && !force) {
      v.label.visible = this.editor.viewport.zoom > 0.38
      return
    }
    const old = v.record
    v.root.position.set(e.x, e.y)
    if (
      !force &&
      old &&
      v.state === state &&
      old.id === e.id &&
      old.equipment_type === e.equipment_type &&
      old.rotation === e.rotation &&
      old.bus_length === e.bus_length
    ) {
      v.record = e
      v.label.visible = this.editor.viewport.zoom > 0.38
      return
    }
    v.record = e
    v.state = state
    v.body.rotation = (e.rotation * Math.PI) / 180
    const c = CATALOG[e.equipment_type]
    const color = pick?.keys.has(e.key)
      ? 0x16a085
      : hasFailover
        ? pink
        : pick?.owner === e.key
          ? 0x9b65d8
          : selected
            ? blue
            : trigger
              ? 0xe88724
              : target
                ? purple
                : connected
                  ? ink
                  : disconnected
    v.lines.clear()
    drawEquipmentSymbol(v.lines, e.equipment_type, color, e.bus_length)
    if (terminals) {
      if (e.equipment_type !== 'bus')
        for (const p of c.ports)
          v.lines
            .circle(p.x, p.y, 3.4)
            .fill(0xffffff)
            .stroke({ width: DIAGRAM_STROKE_WIDTH, color })
    }
    // Keep existing owner/trigger/selection colors when roles overlap, while
    // still identifying the target with a purple marker beside its symbol.
    const markTarget = target && color !== purple
    if (markTarget) {
      if (!v.targetMarker) {
        v.targetMarker = new Graphics()
        v.root.addChild(v.targetMarker)
      }
      const bounds = equipmentBounds(e)
      v.targetMarker
        .clear()
        .circle(0, 0, 5)
        .fill(0xffffff)
        .stroke({ color: purple, width: 1.8 })
        .circle(0, 0, 2)
        .fill(purple)
      v.targetMarker.position.set(bounds.minX - e.x - 10, bounds.minY - e.y - 10)
    }
    if (v.targetMarker) v.targetMarker.visible = markTarget
    v.label.style.fill =
      selected || trigger || target || hasFailover || pick ? color : connected ? 0x526074 : 0x9aa8b7
    v.label.visible = this.editor.viewport.zoom > 0.38
  }
  private node(e: EquipmentRecord) {
    let v = this.nodes.get(e.key)
    if (!v) {
      v = this.makeNode()
      this.nodes.set(e.key, v)
      this.nodesLayer.addChild(v.root)
    }
    this.updateNode(v, e)
    return v
  }
  private drawPath(g: Graphics, points: Point[], color = 0x657487) {
    g.clear()
    if (!points.length) return
    g.moveTo(points[0].x, points[0].y)
    for (const p of points.slice(1)) g.lineTo(p.x, p.y)
    g.stroke({ color, width: DIAGRAM_STROKE_WIDTH, cap: 'butt', join: 'round' })
  }
  private edge(c: ConnectorRecord) {
    let view = this.edges.get(c.id)
    if (!view) {
      view = { graphics: new Graphics(), record: null, color: -1 }
      this.edges.set(c.id, view)
      this.wires.addChild(view.graphics)
    }
    const color = this.connectorColor(c)
    if (view.record !== c || view.color !== color) {
      this.drawPath(view.graphics, c.points, color)
      view.record = c
      view.color = color
    }
    return view
  }
  private connectorColor(c: ConnectorRecord) {
    return this.editor.selectedConnector === c.id
      ? blue
      : this.editor.isSourceConnected(c.from.equipment_key)
        ? 0x657487
        : disconnected
  }
  private resetMove() {
    if (!this.movingKeys) return
    for (const key of this.movingKeys) {
      const view = this.nodes.get(key)
      if (view) this.nodesLayer.addChild(view.root)
    }
    for (const id of this.movingEdges) {
      const view = this.edges.get(id)
      if (view) {
        this.wires.addChild(view.graphics)
        view.record = null
      }
    }
    for (const id of this.boundaryEdges) {
      const view = this.edges.get(id)
      if (view) view.record = null
    }
    for (const v of this.ghostViews) v.root.destroy({ children: true })
    for (const g of this.ghostEdges) g.destroy()
    this.ghostViews = []
    this.ghostEdges = []
    this.moving.position.set(0, 0)
    this.movingKeys = null
    this.movingEdges.clear()
    this.boundaryEdges.clear()
  }
  private setupMove(keys: Set<string>, duplicate: boolean) {
    if (this.movingKeys === keys && this.movingDuplicate === duplicate) return
    this.resetMove()
    this.movingKeys = keys
    this.movingDuplicate = duplicate
    for (const key of keys) {
      const e = this.editor.equipment.get(key)
      if (!e) continue
      if (duplicate) {
        const v = this.makeNode()
        this.updateNode(v, e)
        v.root.alpha = 0.65
        this.moving.addChild(v.root)
        this.ghostViews.push(v)
      } else this.moving.addChild(this.node(e).root)
    }
    const affected = new Set<string>()
    for (const key of keys) for (const id of this.editor.adjacency.get(key) ?? []) affected.add(id)
    for (const id of affected) {
      const c = this.editor.connectors.get(id)!
      if (keys.has(c.from.equipment_key) && keys.has(c.to.equipment_key)) {
        this.movingEdges.add(id)
        if (duplicate) {
          const g = new Graphics()
          this.drawPath(g, c.points, blue)
          g.alpha = 0.55
          this.moving.addChildAt(g, 0)
          this.ghostEdges.push(g)
        } else this.moving.addChildAt(this.edge(c).graphics, 0)
      } else if (!duplicate) this.boundaryEdges.add(id)
    }
  }
  render() {
    if (this.disposed || !this.app.renderer) return
    const started = performance.now(),
      e = this.editor,
      v = e.viewport,
      w = this.host.clientWidth,
      h = this.host.clientHeight
    this.world.position.set(v.x, v.y)
    this.world.scale.set(v.zoom)
    const gridStep = 24 * (v.zoom < 0.35 ? 4 : v.zoom < 0.7 ? 2 : 1) * v.zoom
    const grid = `${gridStep}/${v.x}/${v.y}`
    if (grid !== this.lastGrid) {
      this.host.style.backgroundSize = `${gridStep}px ${gridStep}px`
      this.host.style.backgroundPosition = `${v.x}px ${v.y}px`
      this.lastGrid = grid
    }
    const bounds = {
      minX: (-v.x - 150) / v.zoom,
      minY: (-v.y - 150) / v.zoom,
      maxX: (w - v.x + 150) / v.zoom,
      maxY: (h - v.y + 150) / v.zoom,
    }
    const visibleNodes = new Set(e.equipmentIndex.query(bounds)),
      visibleEdges = new Set(e.connectorIndex.query(bounds))
    const preview = e.preview
    if (v.zoom > 0.38) for (const key of e.labelIndex.query(bounds)) visibleNodes.add(key)
    if (preview?.kind === 'label') visibleNodes.add(preview.key)
    if (preview?.kind === 'move') {
      this.setupMove(preview.keys, preview.duplicate)
      this.moving.position.set(preview.dx, preview.dy)
      for (const key of preview.keys) visibleNodes.add(key)
      for (const id of this.movingEdges) visibleEdges.add(id)
      for (const id of this.boundaryEdges) visibleEdges.add(id)
    } else this.resetMove()
    for (const [key, view] of this.nodes) {
      view.root.visible = visibleNodes.has(key)
      if (!e.equipment.has(key)) {
        view.root.destroy({ children: true })
        this.nodes.delete(key)
      }
    }
    for (const key of visibleNodes) {
      const item = e.equipment.get(key)
      if (item) {
        const node = this.node(item)
        node.root.visible = true
      }
    }
    for (const [id, view] of this.edges) {
      view.graphics.visible = visibleEdges.has(id)
      if (!e.connectors.has(id)) {
        view.graphics.destroy()
        this.edges.delete(id)
      }
    }
    for (const id of visibleEdges) {
      const c = e.connectors.get(id)
      if (c) {
        const existing = this.edges.get(id)
        if (preview?.kind === 'move' && this.boundaryEdges.has(id) && existing)
          existing.graphics.visible = true
        else this.edge(c).graphics.visible = true
      }
    }
    if (preview?.kind === 'move' && !preview.duplicate) {
      const get = (key: string) => {
        const original = e.equipment.get(key)
        return original && preview.keys.has(key)
          ? { ...original, x: original.x + preview.dx, y: original.y + preview.dy }
          : original
      }
      for (const id of this.boundaryEdges) {
        const c = e.connectors.get(id)!
        const view = this.edges.get(id) ?? this.edge(c)
        this.drawPath(
          view.graphics,
          translateConnector(
            c,
            { get },
            {
              get: (key) => (preview.keys.has(key) ? { x: preview.dx, y: preview.dy } : undefined),
            },
          ).points,
          this.connectorColor(c),
        )
        view.record = null
      }
    }
    if (preview?.kind === 'bus') {
      const item = this.nodes.get(preview.key)
      if (item) this.updateNode(item, preview.equipment, true)
    }
    if (preview?.kind === 'bend') {
      const c = e.connectors.get(preview.id)!
      const next = { ...c, bends: preview.bends, routing: 'manual' as const }
      this.drawPath(this.edge(c).graphics, routeConnector(next, e.equipment), blue)
      this.edges.get(c.id)!.record = null
    }
    this.overlay.clear()
    const stroke = 1.2 / v.zoom
    if (e.selection.size === 1 && !e.failoverPick) {
      const item = e.equipment.get([...e.selection][0])!
      if (item.equipment_type === 'bus') {
        const shown = preview?.kind === 'bus' ? preview.equipment : item
        for (const side of [-1, 1]) {
          const p = worldPoint(shown, { x: ((shown.bus_length ?? 200) / 2) * side, y: 0 })
          if (preview?.kind === 'move') {
            p.x += preview.dx
            p.y += preview.dy
          }
          this.overlay
            .rect(p.x - 4 / v.zoom, p.y - 4 / v.zoom, 8 / v.zoom, 8 / v.zoom)
            .fill(0xffffff)
            .stroke({ color: blue, width: stroke })
        }
      }
    }
    if (e.selectedConnector) {
      const c = e.connectors.get(e.selectedConnector)
      if (c)
        for (let i = 1; i < c.points.length; i++) {
          const a = c.points[i - 1],
            b = c.points[i]
          this.overlay
            .circle((a.x + b.x) / 2, (a.y + b.y) / 2, 3.5 / v.zoom)
            .fill(0xffffff)
            .stroke({ color: blue, width: stroke })
        }
    }
    if (preview?.kind === 'marquee') {
      const b = preview.bounds
      this.overlay
        .rect(b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY)
        .fill({ color: blue, alpha: 0.06 })
        .stroke({ color: blue, width: stroke })
    }
    if (preview?.kind === 'wire') {
      const start = endpointPosition(e.equipment.get(preview.from.equipment_key)!, preview.from)
      this.overlay
        .moveTo(start.x, start.y)
        .lineTo(start.x, preview.to.y)
        .lineTo(preview.to.x, preview.to.y)
        .stroke({ color: blue, width: DIAGRAM_STROKE_WIDTH, cap: 'butt', join: 'round' })
    }
    if (e.snap) {
      for (const ep of [e.snap.from, e.snap.to]) {
        const item = e.equipment.get(ep.equipment_key)
        if (!item) continue
        const p = endpointPosition(item, ep)
        if (preview?.kind === 'move' && preview.keys.has(item.key)) {
          p.x += preview.dx
          p.y += preview.dy
        }
        this.overlay
          .circle(p.x, p.y, 7 / v.zoom)
          .fill({ color: blue, alpha: 0.12 })
          .stroke({ color: blue, width: 1.5 / v.zoom })
      }
    }
    const placement =
      preview?.kind === 'place'
        ? preview.point && { type: preview.type, point: preview.point }
        : e.tool === 'place'
          ? { type: e.placement, point: e.pointer }
          : null
    this.ghost.visible = !!placement
    if (placement) {
      if (!this.placementGhost) {
        this.placementGhost = this.makeNode()
        this.ghost.addChild(this.placementGhost.root)
      }
      const node = this.placementGhost
      this.updateNode(node, {
        key: 'ghost',
        id: CATALOG[placement.type].short,
        equipment_type: placement.type,
        ...placement.point,
        rotation: 0,
        kv_rating: null,
        amp_rating: null,
        derating_multiplier: 1,
        ...(placement.type === 'bus' ? { bus_length: 200 } : {}),
      })
      node.root.alpha = 0.45
    }
    this.app.render()
    this.metrics.frames++
    this.metrics.visibleEquipment = visibleNodes.size
    this.metrics.visibleConnectors = visibleEdges.size
    this.metrics.renderMs.push(performance.now() - started)
    if (this.metrics.renderMs.length > 1200) this.metrics.renderMs.shift()
  }
  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.frameId)
    this.unsubscribe()
    this.observer?.disconnect()
    if (this.app.renderer) {
      this.app.canvas.removeEventListener('webglcontextlost', this.contextLost)
      this.app.canvas.removeEventListener('webglcontextrestored', this.contextRestored)
      this.app.destroy(true, { children: true, texture: false, textureSource: false })
    }
  }
}
