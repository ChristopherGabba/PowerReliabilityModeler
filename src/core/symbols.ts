import { CATALOG } from './catalog'
import type { EquipmentType, Point } from './types'

// Matches the outdoor breaker's outline at its catalog size. Geometry is in
// canvas units: resizing a symbol's footprint must never rescale its stroke.
export const DIAGRAM_STROKE_WIDTH = 1.4

export function equipmentSymbolStrokeWidth(type: EquipmentType): number {
  return type === 'bus' ? DIAGRAM_STROKE_WIDTH * 2 : DIAGRAM_STROKE_WIDTH
}

const circle = (x: number, y: number, radius: number) =>
  `M ${x} ${y - radius} a ${radius} ${radius} 0 1 1 0 ${radius * 2} a ${radius} ${radius} 0 1 1 0 ${-radius * 2} Z`

function utilityPath() {
  const triangle: Point[] = [
    { x: -29, y: -22.5 },
    { x: 29, y: -22.5 },
    { x: 0, y: 16 },
  ]
  const paths = ['M -29 -22.5 H 29 L 0 16 Z M 0 16 V 38']
  for (const slope of [-1, 1]) {
    for (let offset = -60; offset <= 60; offset += 12) {
      const intersections: Point[] = []
      for (let i = 0; i < triangle.length; i++) {
        const a = triangle[i],
          b = triangle[(i + 1) % triangle.length]
        const t = (slope * a.x + offset - a.y) / (b.y - a.y - slope * (b.x - a.x))
        if (t >= 0 && t <= 1)
          intersections.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
      }
      if (intersections.length >= 2) {
        const [a, b] = intersections
        paths.push(`M ${a.x} ${a.y} L ${b.x} ${b.y}`)
      }
    }
  }
  return paths.join(' ')
}

// Each symbol includes its complete leads to the catalog terminals. No raster
// stem or separate generic extension is layered over these centerlines.
const transformer = `M 0 -48 V -30 ${circle(0, -13, 17)} ${circle(0, 13, 17)} M 0 30 V 48`
const paths: Record<Exclude<EquipmentType, 'bus'>, string> = {
  utility_source: utilityPath(),
  indoor_drawout_breaker: [
    'M 0 -40 V -16.5',
    circle(0, -14, 2.5),
    'M 0 -11.5 C -17 -11.5 -17 11.5 0 11.5',
    circle(0, 14, 2.5),
    'M 0 16.5 V 40',
    'M -4 -31 L 0 -35 L 4 -31 M -4 -36 L 0 -40 L 4 -36',
    'M -4 31 L 0 35 L 4 31 M -4 36 L 0 40 L 4 36',
  ].join(' '),
  outdoor_mv_hv_breaker: 'M 0 -40 V -11.5 M -11.5 -11.5 H 11.5 V 11.5 H -11.5 Z M 0 11.5 V 40',
  disconnect_switch: [
    'M 0 -30 V -11.2',
    circle(0, -9, 2.2),
    'M 0 6.8 L 5 -13',
    circle(0, 9, 2.2),
    'M 0 11.2 V 30',
  ].join(' '),
  oil_filled_transformer: transformer,
  dry_type_transformer: transformer,
  load: 'M 0 -36 V -20 M -24 -20 H 24 L 0 22 Z',
  ring_main_unit: [
    'M -34 -52 V -36 M -45 -36 H -23 V -14 H -45 Z',
    'M 34 -52 V -36 M 23 -36 H 45 V -14 H 23 Z',
    'M -34 -14 V 8 H 34 V -14 M 0 8 V 24',
    'M -11 24 H 11 V 46 H -11 Z M 0 46 V 52',
  ].join(' '),
  cable:
    'M 0 -40 V -29 M -6 -29 H 6 V 29 H -6 Z M 0 29 V 40 M -2.5 -24 V 24 M 2.5 -24 V 24 M -6 8 L 6 -8',
  generator: `${circle(0, 0, 27)} M 0 27 V 38 M 9 -7 C 5 -15 -11 -14 -11 0 C -11 14 5 15 10 7 V 0 H 1`,
}

export function equipmentSymbolPath(type: EquipmentType, busLength = 200): string {
  return type === 'bus' ? `M ${-busLength / 2} 0 H ${busLength / 2}` : paths[type]
}

export function equipmentSymbolFill(type: EquipmentType): string | undefined {
  // The oil drop is an identifying solid glyph, rather than an electrical line.
  return type === 'oil_filled_transformer'
    ? 'M 0 13 C -1 16 -4 18 -4 20 A 4 4 0 0 0 4 20 C 4 18 1 16 0 13 Z'
    : undefined
}

export function equipmentSymbolViewBox(type: EquipmentType): string {
  const catalog = CATALOG[type]
  const half =
    Math.max(
      catalog.width / 2,
      catalog.height / 2,
      ...catalog.ports.map((port) => Math.max(Math.abs(port.x), Math.abs(port.y))),
    ) + 6
  return `${-half} ${-half} ${half * 2} ${half * 2}`
}
