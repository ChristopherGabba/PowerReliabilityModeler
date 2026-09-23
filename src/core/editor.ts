import { equipmentLabel, labelAnchor, type LabelOffset, type LabelOffsets } from './labels'
import { ARRANGEMENT_LABELS, arrangementTranslations, type Arrangement } from './arrangement'
import { CATALOG } from './catalog'
import {
  boundsOf,
  busTap,
  distance,
  endpointPosition,
  equipmentBounds,
  localPoint,
  ports,
  rotatePoint,
  routeConnector,
  segmentDistance,
  SpatialIndex,
  translateConnector,
  worldPoint,
} from './geometry'
import { validateDocument } from './schema'
import {
  emptyDocument,
  uid,
  type Bounds,
  type ConnectorRecord,
  type DocumentRecord,
  type EndpointRecord,
  type EquipmentRecord,
  type EquipmentType,
  type FailoverRecord,
  type GroupRecord,
  type Patch,
  type Point,
  type Viewport,
} from './types'

type Header = Pick<DocumentRecord, 'model_name' | 'model_revision' | 'model_date'>
type Transaction = {
  label: string
  equipment: Map<string, EquipmentRecord | undefined>
  connectors: Map<string, ConnectorRecord | undefined>
  failovers: FailoverRecord[]
  groups: GroupRecord[]
  header: Header
  selection: Set<string>
  labels: Map<string, LabelOffset>
}
type History = {
  label: string
  forward: Patch
  backward: Patch
  before: Set<string>
  after: Set<string>
  labelsForward: LabelOffsets
  labelsBackward: LabelOffsets
}
export type Preview =
  | { kind: 'place'; type: EquipmentType; point: Point | null }
  | { kind: 'move'; keys: Set<string>; dx: number; dy: number; duplicate: boolean }
  | { kind: 'label'; key: string; offset: Point }
  | { kind: 'marquee'; bounds: Bounds }
  | { kind: 'wire'; from: EndpointRecord; to: Point }
  | { kind: 'bus'; key: string; equipment: EquipmentRecord }
  | { kind: 'bend'; id: string; bends: Point[] }
  | null
export type FailoverPick = { owner: string; kind: 'triggers' | 'parent'; keys: ReadonlySet<string> }

export class Editor {
  equipment = new Map<string, EquipmentRecord>()
  connectors = new Map<string, ConnectorRecord>()
  failovers: FailoverRecord[] = []
  groups: GroupRecord[] = []
  header: Header
  viewport: Viewport
  selection = new Set<string>()
  selectedConnector: string | null = null
  inspector: string | null = null
  tool: 'select' | 'hand' | 'place' = 'select'
  placement: EquipmentType = 'utility_source'
  pointer: Point = { x: 0, y: 0 }
  hover: string | null = null
  preview: Preview = null
  snap: { from: EndpointRecord; to: EndpointRecord } | null = null
  failoverPick: FailoverPick | null = null
  notice = ''
  readonly labelOffsets = new Map<string, LabelOffset>()
  readonly labelIndex = new SpatialIndex()
  private labelSizes = new Map<string, { width: number; height: number; details: boolean }>()
  private labelListeners = new Set<(offsets: LabelOffsets) => void>()
  private failoverSelection: Set<string> | null = null
  private selectedFailoverDefinitions: FailoverRecord[] | null = null
  private selectedTriggers = new Set<string>()
  private selectedTargets = new Set<string>()
  private linkedFailoverDefinitions: FailoverRecord[] | null = null
  private linkedFailoverOwners = new Set<string>()
  readonly equipmentIndex = new SpatialIndex()
  readonly connectorIndex = new SpatialIndex()
  readonly adjacency = new Map<string, Set<string>>()
  private occupied = new Map<string, string>()
  private publicIds = new Set<string>()
  private sourceConnectivityDirty = true
  private sourceConnected = new Set<string>()
  private uiListeners = new Set<() => void>()
  private frameListeners = new Set<(immediate: boolean) => void>()
  private changeListeners = new Set<(patch: Patch, label: string) => void>()
  private version = 0
  revision = 0
  private transactionState: Transaction | null = null
  private past: History[] = []
  private future: History[] = []
  constructor(document = emptyDocument()) {
    const d = validateDocument(document)
    this.header = {
      model_name: d.model_name,
      model_revision: d.model_revision,
      model_date: d.model_date,
    }
    this.viewport = d.viewport
    this.failovers = d.failovers
    this.groups = d.groups
    for (const e of d.equipment) this.writeEquipment(e.key, e)
    for (const c of d.connectors) this.writeConnector(c.id, c)
  }
  subscribe = (fn: () => void) => {
    this.uiListeners.add(fn)
    return () => {
      this.uiListeners.delete(fn)
    }
  }
  getSnapshot = () => this.version
  onFrame(fn: (immediate: boolean) => void) {
    this.frameListeners.add(fn)
    return () => {
      this.frameListeners.delete(fn)
    }
  }
  onChange(fn: (patch: Patch, label: string) => void) {
    this.changeListeners.add(fn)
    return () => {
      this.changeListeners.delete(fn)
    }
  }
  frame(immediate = false) {
    for (const fn of this.frameListeners) fn(immediate)
  }
  notify() {
    if (this.failoverPick) {
      const pick = this.failoverPick
      if (!this.equipment.has(pick.owner) || this.inspector !== pick.owner) this.failoverPick = null
      else {
        // Picking reflects the saved definition, including sidebar removals and undo/redo.
        const f = this.failovers.find((f) => f.equipment_key === pick.owner)
        pick.keys = new Set(
          pick.kind === 'triggers' ? (f?.trigger_keys ?? []) : f?.parent_key ? [f.parent_key] : [],
        )
      }
    }
    // Once opened, the inspector follows selection changes from clicks, paste,
    // placement, or history. Empty selection keeps the panel in place.
    if (
      this.inspector &&
      !this.failoverPick &&
      this.selection.size &&
      !this.selection.has(this.inspector)
    )
      this.inspector = this.selection.values().next().value ?? this.inspector
    this.version++
    for (const fn of this.uiListeners) fn()
    this.frame()
  }
  message(text: string) {
    this.notice = text
    this.notify()
  }
  get canUndo() {
    return this.past.length > 0
  }
  get canRedo() {
    return this.future.length > 0
  }
  snapshot(): DocumentRecord {
    return {
      schema_version: 1,
      ...this.header,
      equipment: [...this.equipment.values()],
      connectors: [...this.connectors.values()],
      failovers: this.failovers,
      groups: this.groups,
      viewport: this.viewport,
    }
  }
  private refreshSelectedFailovers() {
    if (
      this.failoverSelection !== this.selection ||
      this.selectedFailoverDefinitions !== this.failovers
    ) {
      this.selectedTriggers = new Set()
      this.selectedTargets = new Set()
      for (const f of this.failovers) {
        if (!this.selection.has(f.equipment_key)) continue
        for (const key of f.trigger_keys) this.selectedTriggers.add(key)
        if (f.parent_key) this.selectedTargets.add(f.parent_key)
      }
      this.failoverSelection = this.selection
      this.selectedFailoverDefinitions = this.failovers
    }
  }
  isSelectedTrigger(key: string): boolean {
    this.refreshSelectedFailovers()
    return this.selectedTriggers.has(key)
  }
  isSelectedTarget(key: string): boolean {
    this.refreshSelectedFailovers()
    return this.selectedTargets.has(key)
  }
  hasFailoverLinks(key: string): boolean {
    // Rendering asks for every visible device. Rebuild only when links change,
    // including history replay, rather than scanning all failovers per symbol.
    if (this.linkedFailoverDefinitions !== this.failovers) {
      this.linkedFailoverOwners = new Set(
        this.failovers
          .filter((f) => f.trigger_keys.length > 0 || f.parent_key !== null)
          .map((f) => f.equipment_key),
      )
      this.linkedFailoverDefinitions = this.failovers
    }
    return this.linkedFailoverOwners.has(key)
  }
  onLabelChange(fn: (offsets: LabelOffsets) => void) {
    this.labelListeners.add(fn)
    return () => {
      this.labelListeners.delete(fn)
    }
  }
  loadLabelOffsets(offsets: LabelOffsets) {
    for (const [key, point] of Object.entries(offsets)) this.writeLabelOffset(key, point)
    this.frame()
  }
  labelPosition(e: EquipmentRecord): Point {
    const offset = this.labelOffsets.get(e.key)
    const bounds = equipmentBounds(e)
    // Existing private offsets were measured from underneath the equipment.
    // Retain that anchor so previously dragged labels do not move on upgrade.
    if (offset && labelAnchor(offset) === 'below')
      return { x: e.x + offset.x, y: bounds.maxY + 3 + offset.y }
    const { width, height } = this.labelSize(e)
    return {
      x: bounds.maxX + 8 + width / 2 + (offset?.x ?? 0),
      y: e.y - height / 2 + (offset?.y ?? 0),
    }
  }
  measureLabel(key: string, width: number, height: number, details: boolean) {
    const previous = this.labelSizes.get(key)
    if (previous?.width === width && previous.height === height && previous.details === details)
      return
    this.labelSizes.set(key, { width, height, details })
    const e = this.equipment.get(key)
    if (e) this.indexLabel(e)
  }
  private labelSize(e: EquipmentRecord) {
    const size = this.labelSizes.get(e.key)
    const width =
      size?.width ??
      Math.max(
        ...equipmentLabel(e)
          .split('\n')
          .map((line) => line.length),
      ) * 7
    const height = size?.height ?? 60
    return { width, height }
  }
  private labelBounds(e: EquipmentRecord): Bounds {
    const p = this.labelPosition(e)
    const { width, height } = this.labelSize(e)
    return {
      minX: p.x - width / 2 - 3,
      maxX: p.x + width / 2 + 3,
      minY: p.y - 2,
      maxY: p.y + height + 2,
    }
  }
  private indexLabel(e: EquipmentRecord) {
    this.labelIndex.set(e.key, this.labelBounds(e))
  }
  hitLabel(p: Point): string | null {
    if (this.viewport.zoom <= 0.38) return null
    const hits = [...this.labelIndex.query({ minX: p.x, maxX: p.x, minY: p.y, maxY: p.y })]
    return (
      hits.reverse().find((key) => {
        const e = this.equipment.get(key)
        if (!e) return false
        // Below the detail threshold only the ID line is visible / interactive.
        return this.viewport.zoom >= 0.65 || p.y <= this.labelPosition(e).y + 16
      }) ?? null
    )
  }
  private writeLabelOffset(key: string, point: LabelOffset) {
    this.labelOffsets.set(key, point)
    const e = this.equipment.get(key)
    if (e) this.indexLabel(e)
  }
  setLabelOffset(key: string, point: LabelOffset) {
    if (!this.equipment.has(key)) return
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y))
      throw new Error('Label position must be finite')
    const previous: LabelOffset = this.labelOffsets.get(key) ?? { x: 0, y: 0, anchor: 'right' }
    const next = { ...point, anchor: point.anchor ?? labelAnchor(previous) }
    if (point.x === previous.x && point.y === previous.y && next.anchor === labelAnchor(previous))
      return
    this.transaction('Move label', () => {
      const labels = this.transactionState!.labels
      if (!labels.has(key)) labels.set(key, previous)
      this.writeLabelOffset(key, next)
    })
  }
  private emitLabels(offsets: LabelOffsets) {
    if (Object.keys(offsets).length) for (const fn of this.labelListeners) fn(offsets)
  }
  isSourceConnected(key: string): boolean {
    if (this.sourceConnectivityDirty) {
      const connected = new Set<string>()
      const queue: string[] = []
      for (const item of this.equipment.values()) {
        if (item.equipment_type === 'utility_source' || item.equipment_type === 'generator') {
          connected.add(item.key)
          queue.push(item.key)
        }
      }
      for (let i = 0; i < queue.length; i++) {
        const current = queue[i]
        for (const id of this.adjacency.get(current) ?? []) {
          const connector = this.connectors.get(id)!
          const other =
            connector.from.equipment_key === current
              ? connector.to.equipment_key
              : connector.from.equipment_key
          if (!connected.has(other) && this.equipment.has(other)) {
            connected.add(other)
            queue.push(other)
          }
        }
      }
      this.sourceConnected = connected
      this.sourceConnectivityDirty = false
    }
    return this.sourceConnected.has(key)
  }
  private writeEquipment(key: string, value: EquipmentRecord | undefined) {
    const previous = this.equipment.get(key)
    if (previous?.equipment_type !== value?.equipment_type) this.sourceConnectivityDirty = true
    if (previous) this.publicIds.delete(previous.id)
    if (value) {
      this.equipment.set(key, value)
      this.publicIds.add(value.id)
      this.equipmentIndex.set(key, equipmentBounds(value))
      if (
        previous?.id !== value.id ||
        previous?.kv_rating !== value.kv_rating ||
        previous?.amp_rating !== value.amp_rating ||
        previous?.derating_multiplier !== value.derating_multiplier
      )
        this.labelSizes.delete(key)
      this.indexLabel(value)
    } else {
      this.equipment.delete(key)
      this.equipmentIndex.delete(key)
      this.labelIndex.delete(key)
      this.labelSizes.delete(key)
    }
  }
  private writeConnector(id: string, value: ConnectorRecord | undefined) {
    const old = this.connectors.get(id)
    if (
      old?.from.equipment_key !== value?.from.equipment_key ||
      old?.to.equipment_key !== value?.to.equipment_key
    )
      this.sourceConnectivityDirty = true
    if (old)
      for (const ep of [old.from, old.to]) {
        this.adjacency.get(ep.equipment_key)?.delete(id)
        if (ep.port_id !== 'bar') this.occupied.delete(`${ep.equipment_key}/${ep.port_id}`)
      }
    if (value) {
      this.connectors.set(id, value)
      this.connectorIndex.set(id, boundsOf(value.points, 8))
      for (const ep of [value.from, value.to]) {
        let set = this.adjacency.get(ep.equipment_key)
        if (!set) this.adjacency.set(ep.equipment_key, (set = new Set()))
        set.add(id)
        if (ep.port_id !== 'bar') this.occupied.set(`${ep.equipment_key}/${ep.port_id}`, id)
      }
    } else {
      this.connectors.delete(id)
      this.connectorIndex.delete(id)
    }
  }
  private putEquipment(key: string, value: EquipmentRecord | undefined) {
    const t = this.transactionState!
    if (!t.equipment.has(key)) t.equipment.set(key, this.equipment.get(key))
    this.writeEquipment(key, value)
  }
  private putConnector(id: string, value: ConnectorRecord | undefined) {
    const t = this.transactionState!
    if (!t.connectors.has(id)) t.connectors.set(id, this.connectors.get(id))
    this.writeConnector(id, value)
  }
  transaction(label: string, run: () => void) {
    if (this.transactionState) {
      run()
      return
    }
    const t: Transaction = {
      label,
      labels: new Map(),
      equipment: new Map(),
      connectors: new Map(),
      failovers: this.failovers,
      groups: this.groups,
      header: this.header,
      selection: new Set(this.selection),
    }
    this.transactionState = t
    try {
      run()
    } catch (error) {
      for (const [k, e] of t.equipment) this.writeEquipment(k, e)
      for (const [k, c] of t.connectors) this.writeConnector(k, c)
      for (const [k, point] of t.labels) this.writeLabelOffset(k, point)
      this.failovers = t.failovers
      this.groups = t.groups
      this.header = t.header
      this.selection = t.selection
      this.transactionState = null
      this.notify()
      throw error
    }
    this.transactionState = null
    const changes = <T>(
      old: Map<string, T | undefined>,
      current: Map<string, T>,
      reverse: boolean,
    ) => {
      const put: T[] = [],
        remove: string[] = []
      for (const [key, previous] of old) {
        const value = reverse ? previous : current.get(key)
        if (value) put.push(value)
        else remove.push(key)
      }
      return { put, remove }
    }
    const make = (reverse: boolean): Patch => ({
      equipment: changes(t.equipment, this.equipment, reverse),
      connectors: changes(t.connectors, this.connectors, reverse),
      ...(t.failovers === this.failovers
        ? {}
        : { failovers: reverse ? t.failovers : this.failovers }),
      ...(t.groups === this.groups ? {} : { groups: reverse ? t.groups : this.groups }),
      ...(t.header === this.header ? {} : { header: reverse ? t.header : this.header }),
    })
    const forward = make(false),
      backward = make(true)
    if (
      t.labels.size ||
      t.equipment.size ||
      t.connectors.size ||
      forward.failovers ||
      forward.groups ||
      forward.header
    ) {
      this.past.push({
        label,
        forward,
        backward,
        labelsForward: Object.fromEntries(
          [...t.labels.keys()].map((key) => [key, this.labelOffsets.get(key)!]),
        ),
        labelsBackward: Object.fromEntries(t.labels),
        before: t.selection,
        after: new Set(this.selection),
      })
      if (this.past.length > 100) this.past.shift()
      this.future = []
      this.emitLabels(this.past[this.past.length - 1].labelsForward)
      this.emit(forward, label)
    } else this.notify()
  }
  private emit(patch: Patch, label: string) {
    if (
      patch.equipment.put.length ||
      patch.equipment.remove.length ||
      patch.connectors.put.length ||
      patch.connectors.remove.length ||
      patch.failovers ||
      patch.groups ||
      patch.header ||
      patch.viewport
    ) {
      this.revision++
      for (const fn of this.changeListeners) fn(patch, label)
    }
    this.notify()
  }
  private replay(p: Patch) {
    for (const k of p.connectors.remove) this.writeConnector(k, undefined)
    for (const k of p.equipment.remove) this.writeEquipment(k, undefined)
    for (const e of p.equipment.put) this.writeEquipment(e.key, e)
    for (const c of p.connectors.put) this.writeConnector(c.id, c)
    if (p.failovers) this.failovers = p.failovers
    if (p.groups) this.groups = p.groups
    if (p.header) this.header = p.header
    if (p.viewport) this.viewport = p.viewport
  }
  undo() {
    const h = this.past.pop()
    if (!h) return
    this.replay(h.backward)
    this.loadLabelOffsets(h.labelsBackward)
    this.emitLabels(h.labelsBackward)
    this.selection = new Set([...h.before].filter((k) => this.equipment.has(k)))
    this.future.push(h)
    this.selectedConnector = null
    this.emit(h.backward, `Undo ${h.label}`)
  }
  redo() {
    const h = this.future.pop()
    if (!h) return
    this.replay(h.forward)
    this.loadLabelOffsets(h.labelsForward)
    this.emitLabels(h.labelsForward)
    this.selection = new Set([...h.after].filter((k) => this.equipment.has(k)))
    this.past.push(h)
    this.selectedConnector = null
    this.emit(h.forward, `Redo ${h.label}`)
  }
  uniqueId(base: string, nextAvailable?: Map<string, bigint>) {
    if (!this.publicIds.has(base)) return base
    const suffix = base.match(/\d+$/)?.[0]
    const prefix = suffix ? base.slice(0, -suffix.length) : `${base}_`
    const width = suffix?.startsWith('0') ? suffix.length : 0
    let number = suffix ? BigInt(suffix) + 1n : 1n
    const skipped: string[] = []
    let candidate = prefix + number.toString().padStart(width, '0')
    while (this.publicIds.has(candidate)) {
      if (nextAvailable) skipped.push(candidate)
      number = nextAvailable?.get(candidate) ?? number + 1n
      candidate = prefix + number.toString().padStart(width, '0')
    }
    if (candidate.length > 200)
      throw new Error(
        'Shorten the equipment ID before copying; the next numbered ID exceeds 200 characters',
      )
    // Reuse searches within a bulk paste without keeping stale hints after undo or rename.
    for (const id of skipped) nextAvailable!.set(id, number)
    return candidate
  }
  add(type: EquipmentType, p: Point) {
    let key = ''
    this.transaction('Add equipment', () => {
      key = uid()
      this.putEquipment(key, {
        key,
        id: this.uniqueId(`${type}_1`),
        equipment_type: type,
        x: p.x,
        y: p.y,
        rotation: 0,
        kv_rating: null,
        amp_rating: null,
        derating_multiplier: 1,
        ...(type === 'bus' ? { bus_length: 200 } : {}),
      })
      this.selection = new Set([key])
      this.autoConnect(new Set([key]))
    })
    return key
  }
  update(
    key: string,
    values: Partial<
      Pick<EquipmentRecord, 'id' | 'kv_rating' | 'amp_rating' | 'derating_multiplier'>
    >,
  ) {
    const e = this.equipment.get(key)
    if (!e) return
    const next = { ...e, ...values }
    if (!next.id.trim() || next.id !== next.id.trim() || next.id.length > 200)
      throw new Error('Enter an ID without outer spaces (up to 200 characters)')
    if (next.id !== e.id && this.publicIds.has(next.id))
      throw new Error('That equipment ID already exists')
    for (const n of [next.kv_rating, next.amp_rating])
      if (n !== null && (!Number.isFinite(n) || n < 0))
        throw new Error('Ratings must be non-negative numbers')
    if (
      !Number.isFinite(next.derating_multiplier) ||
      next.derating_multiplier < 0 ||
      next.derating_multiplier > 1
    )
      throw new Error('Derating must be between 0 and 1')
    this.transaction('Edit equipment', () => this.putEquipment(key, next))
  }
  updateHeader(values: Partial<Header>) {
    const next = { ...this.header, ...values }
    if (!next.model_name.trim()) throw new Error('Model name is required')
    validateDocument({ ...emptyDocument(), ...next })
    this.transaction('Edit model details', () => {
      this.header = next
    })
  }
  expandGroups(keys: Iterable<string>) {
    const result = new Set(keys)
    for (const g of this.groups)
      if (g.equipment_keys.some((k) => result.has(k)))
        for (const k of g.equipment_keys) result.add(k)
    return result
  }
  select(keys: Iterable<string>, expand = true) {
    this.selection = expand ? this.expandGroups(keys) : new Set(keys)
    if (this.selectedConnector && this.selection.size && !this.failoverPick)
      this.inspector = this.selection.values().next().value ?? null
    this.selectedConnector = null
    this.notify()
  }
  followInspector(key: string) {
    if (this.inspector && this.inspector !== key && this.selection.has(key) && !this.failoverPick) {
      this.inspector = key
      this.notify()
    }
  }
  selectConnector(id: string) {
    this.selection = new Set()
    this.selectedConnector = id
    this.inspector = null
    this.notify()
  }
  setTool(tool: 'select' | 'hand' | 'place', type?: EquipmentType) {
    this.cancel()
    this.tool = tool
    if (type) this.placement = type
    this.notify()
  }
  cancel() {
    this.preview = null
    this.snap = null
    this.failoverPick = null
    this.frame()
  }
  setViewport(view: Viewport, commit = false) {
    this.viewport = { x: view.x, y: view.y, zoom: Math.max(0.02, Math.min(8, view.zoom)) }
    this.frame()
    if (commit) this.commitViewport()
  }
  commitViewport() {
    this.emit(
      {
        equipment: { put: [], remove: [] },
        connectors: { put: [], remove: [] },
        viewport: { ...this.viewport },
      },
      'Viewport',
    )
  }
  selectionBounds(keys = this.selection, includeLabels = false): Bounds | null {
    const points: Point[] = []
    for (const k of keys) {
      const e = this.equipment.get(k)
      if (e) {
        const b = equipmentBounds(e)
        points.push({ x: b.minX, y: b.minY }, { x: b.maxX, y: b.maxY })
        if (includeLabels) {
          const label = this.labelBounds(e)
          points.push({ x: label.minX, y: label.minY }, { x: label.maxX, y: label.maxY })
        }
      }
    }
    return points.length ? boundsOf(points) : null
  }
  private affected(keys: Set<string>) {
    const ids = new Set<string>()
    for (const key of keys) for (const id of this.adjacency.get(key) ?? []) ids.add(id)
    return ids
  }
  arrange(action: Arrangement) {
    const translations = arrangementTranslations(
      this.equipment,
      this.groups,
      this.selection,
      action,
    )
    if (!translations.size) return
    this.transaction(ARRANGEMENT_LABELS[action], () => {
      const affected = this.affected(new Set(translations.keys()))
      for (const [key, delta] of translations) {
        const item = this.equipment.get(key)!
        this.putEquipment(key, { ...item, x: item.x + delta.x, y: item.y + delta.y })
      }
      // Reroute each affected wire once, after all equipment reaches its final
      // position. Move manual bends only when both ends share a translation.
      for (const id of affected) {
        const connector = this.connectors.get(id)!
        const from = translations.get(connector.from.equipment_key)
        const to = translations.get(connector.to.equipment_key)
        const together = from && to && from.x === to.x && from.y === to.y
        const next = {
          ...connector,
          bends: together
            ? connector.bends.map((p) => ({ x: p.x + from.x, y: p.y + from.y }))
            : connector.bends,
        }
        this.putConnector(id, { ...next, points: routeConnector(next, this.equipment) })
      }
    })
  }
  move(keys: Set<string>, dx: number, dy: number, connect = true) {
    if (!dx && !dy) return
    this.transaction('Move equipment', () => {
      const affected = this.affected(keys)
      for (const key of keys) {
        const e = this.equipment.get(key)
        if (e) this.putEquipment(key, { ...e, x: e.x + dx, y: e.y + dy })
      }
      for (const id of affected) {
        const c = this.connectors.get(id)!
        this.putConnector(
          id,
          translateConnector(c, this.equipment, {
            get: (key) => (keys.has(key) ? { x: dx, y: dy } : undefined),
          }),
        )
      }
      if (connect) this.autoConnect(keys)
    })
  }
  rotate(keys = this.selection) {
    const b = this.selectionBounds(keys)
    if (!b) return
    const center = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 }
    if (keys.size === 1) {
      const e = this.equipment.get([...keys][0])!
      center.x = e.x
      center.y = e.y
    }
    this.transaction('Rotate equipment', () => {
      const affected = this.affected(keys)
      for (const key of keys) {
        const e = this.equipment.get(key)!
        const p = rotatePoint({ x: e.x - center.x, y: e.y - center.y }, 90)
        this.putEquipment(key, {
          ...e,
          x: center.x + p.x,
          y: center.y + p.y,
          rotation: (e.rotation + 90) % 360,
        })
      }
      for (const id of affected) {
        const c = this.connectors.get(id)!
        const both = keys.has(c.from.equipment_key) && keys.has(c.to.equipment_key)
        const next = {
          ...c,
          bends: both
            ? c.bends.map((p) => {
                const q = rotatePoint({ x: p.x - center.x, y: p.y - center.y }, 90)
                return { x: center.x + q.x, y: center.y + q.y }
              })
            : c.bends,
        }
        this.putConnector(id, { ...next, points: routeConnector(next, this.equipment) })
      }
    })
  }
  copy(keys = this.selection): DocumentRecord {
    return {
      ...emptyDocument('Clipboard'),
      equipment: [...keys].flatMap((k) => (this.equipment.get(k) ? [this.equipment.get(k)!] : [])),
      connectors: [...this.connectors.values()].filter(
        (c) => keys.has(c.from.equipment_key) && keys.has(c.to.equipment_key),
      ),
      groups: this.groups.filter((g) => g.equipment_keys.every((k) => keys.has(k))),
      failovers: [],
    }
  }
  paste(document: DocumentRecord, dx = 40, dy = 40) {
    const d = validateDocument(document)
    const mapping = new Map<string, string>()
    const nextAvailable = new Map<string, bigint>()
    this.transaction('Duplicate equipment', () => {
      for (const e of d.equipment) {
        const key = uid()
        mapping.set(e.key, key)
        this.putEquipment(key, {
          ...e,
          key,
          id: this.uniqueId(e.id, nextAvailable),
          x: e.x + dx,
          y: e.y + dy,
        })
      }
      for (const [oldKey, key] of mapping) {
        const offset = this.labelOffsets.get(oldKey)
        if (offset) this.setLabelOffset(key, { ...offset, anchor: labelAnchor(offset) })
      }
      for (const c of d.connectors) {
        const id = `connector_${uid()}`
        const next = {
          ...c,
          id,
          from: { ...c.from, equipment_key: mapping.get(c.from.equipment_key)! },
          to: { ...c.to, equipment_key: mapping.get(c.to.equipment_key)! },
          points: c.points.map((p) => ({ x: p.x + dx, y: p.y + dy })),
          bends: c.bends.map((p) => ({ x: p.x + dx, y: p.y + dy })),
        }
        this.putConnector(id, next)
      }
      this.groups = [
        ...this.groups,
        ...d.groups.map((g) => ({
          id: uid(),
          equipment_keys: g.equipment_keys.map((k) => mapping.get(k)!),
        })),
      ]
      this.selection = new Set(mapping.values())
      this.selectedConnector = null
    })
    return this.selection
  }
  duplicate(dx = 40, dy = 40) {
    return this.paste(this.copy(), dx, dy)
  }
  deleteSelection() {
    this.transaction('Delete selection', () => {
      for (const id of this.affected(this.selection)) this.putConnector(id, undefined)
      if (this.selectedConnector) this.putConnector(this.selectedConnector, undefined)
      for (const key of this.selection) this.putEquipment(key, undefined)
      this.failovers = this.failovers
        .filter(
          (f) => !this.selection.has(f.equipment_key) && !this.selection.has(f.parent_key ?? ''),
        )
        .map((f) => ({ ...f, trigger_keys: f.trigger_keys.filter((k) => !this.selection.has(k)) }))
        .filter(
          (f) =>
            f.trigger_keys.length > 0 ||
            !this.failovers
              .find((old) => old.equipment_key === f.equipment_key)!
              .trigger_keys.some((k) => this.selection.has(k)),
        )
      this.groups = this.groups
        .map((g) => ({
          ...g,
          equipment_keys: g.equipment_keys.filter((k) => !this.selection.has(k)),
        }))
        .filter((g) => g.equipment_keys.length > 1)
      this.selection = new Set()
      this.selectedConnector = null
      if (this.inspector && !this.equipment.has(this.inspector)) this.inspector = null
    })
  }
  group() {
    if (this.selection.size < 2) return
    this.transaction('Group equipment', () => {
      const keys = this.expandGroups(this.selection)
      this.groups = this.groups.filter((g) => !g.equipment_keys.some((k) => keys.has(k)))
      this.groups.push({ id: uid(), equipment_keys: [...keys] })
      this.selection = keys
    })
  }
  ungroup() {
    this.transaction('Ungroup equipment', () => {
      this.groups = this.groups.filter((g) => !g.equipment_keys.some((k) => this.selection.has(k)))
    })
  }
  isFree(ep: EndpointRecord) {
    return ep.port_id === 'bar' || !this.occupied.has(`${ep.equipment_key}/${ep.port_id}`)
  }
  connect(from: EndpointRecord, to: EndpointRecord) {
    if (from.equipment_key === to.equipment_key || !this.isFree(from) || !this.isFree(to))
      return null
    let id: string | null = null
    this.transaction('Connect equipment', () => {
      id = `connector_${uid()}`
      const c: ConnectorRecord = {
        id,
        from: { ...from },
        to: { ...to },
        points: [],
        routing: 'auto',
        bends: [],
      }
      this.putConnector(id, { ...c, points: routeConnector(c, this.equipment) })
    })
    return id
  }
  nearestPort(p: Point, exclude = new Set<string>(), radius = 14): EndpointRecord | null {
    let best: EndpointRecord | null = null,
      bestDistance = radius
    for (const key of this.equipmentIndex.query({
      minX: p.x - radius,
      minY: p.y - radius,
      maxX: p.x + radius,
      maxY: p.y + radius,
    })) {
      if (exclude.has(key)) continue
      const e = this.equipment.get(key)!
      const candidates =
        e.equipment_type === 'bus'
          ? [busTap(e, p)]
          : ports(e).map((v) => ({ equipment_key: key, port_id: v.id }))
      for (const ep of candidates) {
        if (!this.isFree(ep)) continue
        const d = distance(p, endpointPosition(e, ep))
        if (d < bestDistance) {
          bestDistance = d
          best = ep
        }
      }
    }
    return best
  }
  findSnap(keys: Set<string>, dx = 0, dy = 0) {
    let best: { from: EndpointRecord; to: EndpointRecord } | null = null,
      bestDistance = 18 / this.viewport.zoom
    for (const key of keys) {
      const e = this.equipment.get(key)
      if (!e || e.equipment_type === 'bus') continue
      for (const p of ports(e)) {
        const from = { equipment_key: key, port_id: p.id }
        if (!this.isFree(from)) continue
        const world = { x: p.x + dx, y: p.y + dy }
        const to = this.nearestPort(world, keys, bestDistance)
        if (to) {
          const d = distance(world, endpointPosition(this.equipment.get(to.equipment_key)!, to))
          if (d < bestDistance) {
            bestDistance = d
            best = { from, to }
          }
        }
      }
    }
    return best
  }
  private autoConnect(keys: Set<string>) {
    const snap = this.findSnap(keys)
    if (snap) this.connect(snap.from, snap.to)
  }
  hitEquipment(p: Point, tolerance = 6) {
    const candidates = this.equipmentIndex.query({
      minX: p.x - tolerance,
      minY: p.y - tolerance,
      maxX: p.x + tolerance,
      maxY: p.y + tolerance,
    })
    for (const key of candidates.reverse()) {
      const e = this.equipment.get(key)!
      const local = localPoint(e, p)
      const c = CATALOG[e.equipment_type]
      const w = e.equipment_type === 'bus' ? (e.bus_length ?? 200) : c.width
      if (Math.abs(local.x) <= w / 2 + tolerance && Math.abs(local.y) <= c.height / 2 + tolerance)
        return key
    }
    return null
  }
  hitConnector(p: Point, tolerance = 7) {
    for (const id of this.connectorIndex.query({
      minX: p.x - tolerance,
      minY: p.y - tolerance,
      maxX: p.x + tolerance,
      maxY: p.y + tolerance,
    })) {
      const c = this.connectors.get(id)!
      for (let i = 1; i < c.points.length; i++)
        if (segmentDistance(p, c.points[i - 1], c.points[i]) < tolerance) return id
    }
    return null
  }
  previewBus(key: string, side: -1 | 1, p: Point): EquipmentRecord {
    const e = this.equipment.get(key)!
    const length = e.bus_length ?? 200
    let left = -length / 2,
      right = length / 2
    const local = localPoint(e, p)
    const taps = [...(this.adjacency.get(key) ?? [])].flatMap((id) => {
      const c = this.connectors.get(id)!
      return [c.from, c.to].filter((ep) => ep.equipment_key === key).map((ep) => ep.tap_offset ?? 0)
    })
    if (side === -1) left = Math.min(local.x, right - 40, ...taps)
    else right = Math.max(local.x, left + 40, ...taps)
    const center = (left + right) / 2
    const position = worldPoint(e, { x: center, y: 0 })
    return { ...e, ...position, bus_length: right - left }
  }
  resizeBus(key: string, next: EquipmentRecord) {
    this.transaction('Resize bus', () => {
      const old = this.equipment.get(key)!
      const shift = localPoint(old, next).x
      this.putEquipment(key, next)
      for (const id of [...(this.adjacency.get(key) ?? [])]) {
        const c = this.connectors.get(id)!
        const adjust = (ep: EndpointRecord) =>
          ep.equipment_key === key ? { ...ep, tap_offset: (ep.tap_offset ?? 0) - shift } : ep
        const adjusted = { ...c, from: adjust(c.from), to: adjust(c.to) }
        this.putConnector(id, { ...adjusted, points: routeConnector(adjusted, this.equipment) })
      }
    })
  }
  setBends(id: string, bends: Point[]) {
    const c = this.connectors.get(id)
    if (!c) return
    this.transaction('Edit connector route', () => {
      const next = { ...c, routing: bends.length ? ('manual' as const) : ('auto' as const), bends }
      this.putConnector(id, { ...next, points: routeConnector(next, this.equipment) })
    })
  }
  setFailover(owner: string, triggerKeys: string[], parent: string | null) {
    if (parent === owner) throw new Error('Choose another item as the Failover Target')
    if (
      !this.equipment.has(owner) ||
      triggerKeys.some((k) => !this.equipment.has(k)) ||
      (parent && !this.equipment.has(parent))
    )
      throw new Error('Failover equipment must belong to this model')
    this.transaction('Edit failover', () => {
      this.failovers = [
        ...this.failovers.filter((f) => f.equipment_key !== owner),
        { equipment_key: owner, trigger_keys: [...new Set(triggerKeys)], parent_key: parent },
      ]
    })
  }
  removeFailover(owner: string) {
    if (this.failoverPick?.owner === owner) this.failoverPick = null
    this.transaction('Remove failover', () => {
      this.failovers = this.failovers.filter((f) => f.equipment_key !== owner)
    })
  }
  startFailoverPick(owner: string, kind: 'triggers' | 'parent') {
    if (!this.equipment.has(owner)) return
    this.cancel()
    this.inspector = owner
    this.selection = new Set([owner])
    this.selectedConnector = null
    this.failoverPick = { owner, kind, keys: new Set() }
    this.tool = 'select'
    this.notify()
  }
  stopFailoverPick() {
    this.failoverPick = null
    this.notify()
  }
  pickFailover(key: string) {
    const pick = this.failoverPick
    if (!pick || !this.equipment.has(key)) return
    const f = this.failovers.find((f) => f.equipment_key === pick.owner)
    if (pick.kind === 'parent') {
      if (key === pick.owner) return
      this.setFailover(pick.owner, f?.trigger_keys ?? [], key)
      this.stopFailoverPick()
    } else {
      const keys = new Set(f?.trigger_keys)
      if (keys.has(key)) keys.delete(key)
      else keys.add(key)
      this.setFailover(pick.owner, [...keys], f?.parent_key ?? null)
    }
  }
  addFailoverTriggers(keys: Iterable<string>) {
    const pick = this.failoverPick
    if (!pick || pick.kind !== 'triggers') return
    const f = this.failovers.find((f) => f.equipment_key === pick.owner)
    const triggers = new Set(f?.trigger_keys)
    for (const key of keys) if (this.equipment.has(key)) triggers.add(key)
    if (triggers.size === (f?.trigger_keys.length ?? 0)) return
    this.setFailover(pick.owner, [...triggers], f?.parent_key ?? null)
  }
}
