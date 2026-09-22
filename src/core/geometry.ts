import { CATALOG } from './catalog'
import type { Bounds, ConnectorRecord, EndpointRecord, EquipmentRecord, Point, Port } from './types'

export function rotatePoint(p: Point, degrees: number): Point {
  const r = ((degrees % 360) + 360) % 360
  if (r === 90) return { x: -p.y, y: p.x }
  if (r === 180) return { x: -p.x, y: -p.y }
  if (r === 270) return { x: p.y, y: -p.x }
  return { ...p }
}
export function worldPoint(e: EquipmentRecord, local: Point): Point {
  const p = rotatePoint(local, e.rotation)
  return { x: e.x + p.x, y: e.y + p.y }
}
export function localPoint(e: EquipmentRecord, world: Point): Point {
  return rotatePoint({ x: world.x - e.x, y: world.y - e.y }, -e.rotation)
}
export function ports(e: EquipmentRecord): Port[] {
  return CATALOG[e.equipment_type].ports.map((p) => {
    const v = rotatePoint({ x: p.dx, y: p.dy }, e.rotation)
    return { ...p, ...worldPoint(e, p), dx: v.x, dy: v.y }
  })
}
export function endpointPosition(
  e: EquipmentRecord,
  ep: Pick<EndpointRecord, 'port_id' | 'tap_offset'>,
  toward?: Point,
): Port {
  if (e.equipment_type === 'bus') {
    const p = worldPoint(e, { x: ep.tap_offset ?? 0, y: 0 })
    // A bar receives wires on either face, including when the bus is rotated.
    const side = toward && localPoint(e, toward).y < 0 ? -1 : 1
    const d = rotatePoint({ x: 0, y: side }, e.rotation)
    return { ...p, id: 'bar', dx: d.x, dy: d.y }
  }
  const p = ports(e).find((p) => p.id === ep.port_id)
  if (!p) throw new Error(`Unknown terminal ${ep.port_id} on ${e.id}`)
  return p
}
export function busTap(e: EquipmentRecord, p: Point): EndpointRecord {
  const local = localPoint(e, p)
  const half = (e.bus_length ?? 200) / 2
  return {
    equipment_key: e.key,
    port_id: 'bar',
    tap_offset: Math.max(-half, Math.min(half, local.x)),
  }
}
export function equipmentBounds(e: EquipmentRecord): Bounds {
  const size = CATALOG[e.equipment_type]
  const w = e.equipment_type === 'bus' ? (e.bus_length ?? 200) : size.width
  const h = size.height
  const points = [
    { x: -w / 2, y: -h / 2 },
    { x: w / 2, y: h / 2 },
    { x: w / 2, y: -h / 2 },
    { x: -w / 2, y: h / 2 },
  ].map((p) => worldPoint(e, p))
  return boundsOf(points, 14)
}
export function boundsOf(points: Point[], pad = 0): Bounds {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity
  for (const p of points) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad }
}
export function intersects(a: Bounds, b: Bounds) {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY
}
export function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}
export function segmentDistance(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x,
    dy = b.y - a.y
  const t = Math.max(
    0,
    Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)),
  )
  return distance(p, { x: a.x + t * dx, y: a.y + t * dy })
}
export function simplify(points: Point[]): Point[] {
  const out: Point[] = []
  for (const p of points) {
    const a = out.at(-1),
      b = out.at(-2)
    if (a && distance(a, p) < 0.001) continue
    if (a && b && ((a.x === b.x && a.x === p.x) || (a.y === b.y && a.y === p.y))) out.pop()
    out.push(p)
  }
  return out
}
export function routeConnector(
  c: ConnectorRecord,
  equipment: Pick<ReadonlyMap<string, EquipmentRecord>, 'get'>,
): Point[] {
  const a = equipment.get(c.from.equipment_key),
    b = equipment.get(c.to.equipment_key)
  if (!a || !b) return []
  let start = endpointPosition(a, c.from)
  const end = endpointPosition(b, c.to, start)
  if (a.equipment_type === 'bus') start = endpointPosition(a, c.from, end)
  if (c.routing === 'manual' && c.bends.length) {
    const result: Point[] = [{ x: start.x, y: start.y }]
    for (const p of [...c.bends, end]) {
      const previous = result.at(-1)!
      if (previous.x !== p.x && previous.y !== p.y) result.push({ x: p.x, y: previous.y })
      result.push({ x: p.x, y: p.y })
    }
    return simplify(result)
  }
  if (start.x === end.x || start.y === end.y)
    return [
      { x: start.x, y: start.y },
      { x: end.x, y: end.y },
    ]
  const lead = 22
  const s = { x: start.x + start.dx * lead, y: start.y + start.dy * lead }
  const t = { x: end.x + end.dx * lead, y: end.y + end.dy * lead }
  let middle: Point[]
  if (start.dx === 0 && end.dx === 0) {
    const y = (s.y + t.y) / 2
    middle = [
      { x: s.x, y },
      { x: t.x, y },
    ]
  } else if (start.dy === 0 && end.dy === 0) {
    const x = (s.x + t.x) / 2
    middle = [
      { x, y: s.y },
      { x, y: t.y },
    ]
  } else middle = [start.dx === 0 ? { x: s.x, y: t.y } : { x: t.x, y: s.y }]
  return simplify([{ x: start.x, y: start.y }, s, ...middle, t, { x: end.x, y: end.y }])
}

// Use the same translation for live dragging and committed moves, so the tap
// does not jump on release. Preserve a deliberately offset tap and clamp it to
// the bar; moving the bus alone keeps its existing local attachment points.
export function translateConnector(
  c: ConnectorRecord,
  equipment: Pick<ReadonlyMap<string, EquipmentRecord>, 'get'>,
  translations: Pick<ReadonlyMap<string, Point>, 'get'>,
): ConnectorRecord {
  const from = translations.get(c.from.equipment_key)
  const to = translations.get(c.to.equipment_key)
  const slide = (ep: EndpointRecord, other: EndpointRecord, delta?: Point, otherDelta?: Point) => {
    const bus = equipment.get(ep.equipment_key)
    const device = equipment.get(other.equipment_key)
    if (bus?.equipment_type !== 'bus' || !otherDelta || !device || device.equipment_type === 'bus')
      return ep
    const along = rotatePoint(
      { x: otherDelta.x - (delta?.x ?? 0), y: otherDelta.y - (delta?.y ?? 0) },
      -bus.rotation,
    ).x
    const half = (bus.bus_length ?? 200) / 2
    const clamp = (offset: number) => Math.max(-half, Math.min(half, offset))
    const position = localPoint(bus, endpointPosition(device, other)).x
    // Ignore travel beyond a bar end so dragging back resumes at the device,
    // instead of carrying accumulated overshoot to the opposite end.
    const travel = clamp(position) - clamp(position - along)
    return { ...ep, tap_offset: clamp((ep.tap_offset ?? 0) + travel) }
  }
  const together = from && to && from.x === to.x && from.y === to.y
  const next = {
    ...c,
    from: slide(c.from, c.to, from, to),
    to: slide(c.to, c.from, to, from),
    bends: together ? c.bends.map((p) => ({ x: p.x + from.x, y: p.y + from.y })) : c.bends,
  }
  return { ...next, points: routeConnector(next, equipment) }
}

// Uniform spatial buckets bound ordinary viewport queries. Very long wires/buses are
// indexed separately so crossing edges are visible without allocating millions of cells.
export class SpatialIndex {
  private cells = new Map<string, Set<string>>()
  private entries = new Map<string, Bounds>()
  private keys = new Map<string, string[]>()
  private large = new Set<string>()
  constructor(private size = 256) {}
  private cellKeys(b: Bounds) {
    const keys: string[] = []
    const x0 = Math.floor(b.minX / this.size),
      x1 = Math.floor(b.maxX / this.size),
      y0 = Math.floor(b.minY / this.size),
      y1 = Math.floor(b.maxY / this.size)
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 256) return keys
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) keys.push(`${x},${y}`)
    return keys
  }
  set(id: string, b: Bounds) {
    this.delete(id)
    this.entries.set(id, b)
    const keys = this.cellKeys(b)
    this.keys.set(id, keys)
    if (!keys.length) this.large.add(id)
    for (const key of keys) {
      let cell = this.cells.get(key)
      if (!cell) this.cells.set(key, (cell = new Set()))
      cell.add(id)
    }
  }
  delete(id: string) {
    for (const key of this.keys.get(id) ?? []) {
      const cell = this.cells.get(key)
      cell?.delete(id)
      if (!cell?.size) this.cells.delete(key)
    }
    this.keys.delete(id)
    this.entries.delete(id)
    this.large.delete(id)
  }
  query(b: Bounds): string[] {
    const found = new Set(this.large)
    const keys = this.cellKeys(b)
    if (!keys.length) {
      for (const id of this.entries.keys()) found.add(id)
    } else for (const key of keys) for (const id of this.cells.get(key) ?? []) found.add(id)
    return [...found].filter((id) => intersects(this.entries.get(id)!, b))
  }
  clear() {
    this.cells.clear()
    this.entries.clear()
    this.keys.clear()
    this.large.clear()
  }
}
