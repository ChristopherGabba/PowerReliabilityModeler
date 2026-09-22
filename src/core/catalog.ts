import type { EquipmentType, Port } from './types'
export type CatalogEntry = {
  name: string
  short: string
  description: string
  width: number
  height: number
  ports: Port[]
}
const terminal = [{ id: 'terminal', x: 0, y: 38, dx: 0, dy: 1 }]
const pair = [
  { id: 'in', x: 0, y: -40, dx: 0, dy: -1 },
  { id: 'out', x: 0, y: 40, dx: 0, dy: 1 },
]
export const CATALOG: Record<EquipmentType, CatalogEntry> = {
  utility_source: {
    name: 'Utility source',
    short: 'Utility',
    description: 'Incoming utility supply',
    width: 64,
    height: 64,
    ports: terminal,
  },
  indoor_drawout_breaker: {
    name: 'Indoor drawout breaker',
    short: 'Indoor breaker',
    description: 'Indoor drawout circuit breaker',
    width: 56,
    height: 56,
    ports: pair,
  },
  outdoor_mv_hv_breaker: {
    name: 'Outdoor MV/HV breaker',
    short: 'Outdoor breaker',
    description: 'Outdoor medium- or high-voltage circuit breaker',
    width: 60,
    height: 60,
    ports: pair,
  },
  disconnect_switch: {
    name: 'Disconnect switch',
    short: 'Disconnect',
    description: 'Two-terminal disconnect switch',
    width: 42,
    height: 45,
    ports: [
      { ...pair[0], y: -30 },
      { ...pair[1], y: 30 },
    ],
  },
  oil_filled_transformer: {
    name: 'Oil-filled transformer',
    short: 'Oil transformer',
    description: 'Two-winding oil-filled transformer',
    width: 72,
    height: 80,
    ports: [
      { ...pair[0], id: 'primary', y: -48 },
      { ...pair[1], id: 'secondary', y: 48 },
    ],
  },
  dry_type_transformer: {
    name: 'Dry-type transformer',
    short: 'Dry transformer',
    description: 'Two-winding dry-type transformer',
    width: 72,
    height: 80,
    ports: [
      { ...pair[0], id: 'primary', y: -48 },
      { ...pair[1], id: 'secondary', y: 48 },
    ],
  },
  load: {
    name: 'Load',
    short: 'Load',
    description: 'Electrical demand',
    width: 56,
    height: 56,
    ports: [{ id: 'terminal', x: 0, y: -36, dx: 0, dy: -1 }],
  },
  bus: {
    name: 'Bus',
    short: 'Bus',
    description: 'Expandable busbar with unlimited taps',
    width: 200,
    height: 12,
    ports: [],
  },
  ring_main_unit: {
    name: 'Ring-main unit',
    short: 'RMU',
    description: 'One unit with three terminals',
    width: 104,
    height: 96,
    ports: [
      { id: 'left', x: -34, y: -52, dx: 0, dy: -1 },
      { id: 'right', x: 34, y: -52, dx: 0, dy: -1 },
      { id: 'feeder', x: 0, y: 52, dx: 0, dy: 1 },
    ],
  },
  cable: {
    name: 'Cable',
    short: 'Cable',
    description: 'Two-terminal cable equipment',
    width: 36,
    height: 72,
    ports: pair,
  },
  generator: {
    name: 'Generator',
    short: 'Generator',
    description: 'Alternate or primary generation',
    width: 64,
    height: 64,
    ports: terminal,
  },
}
