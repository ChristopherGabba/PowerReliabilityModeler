import { Editor } from './editor'
import { routeConnector } from './geometry'
import {
  emptyDocument,
  type ConnectorRecord,
  type DocumentRecord,
  type EquipmentRecord,
  type EquipmentType,
} from './types'

export function exampleDocument(): DocumentRecord {
  const editor = new Editor(emptyDocument('North campus distribution'))
  const add = (type: EquipmentType, id: string, x: number, y: number, kv: number | null = 13.8) => {
    const key = editor.add(type, { x, y })
    editor.update(key, { id, kv_rating: kv, amp_rating: 1200 })
    return key
  }
  const utility = add('utility_source', 'utility_north', -260, -340)
  const breaker = add('outdoor_breaker', 'main_breaker', -260, -160)
  const transformer = add('oil_filled_transformer', 'transformer_01', -260, 40)
  const bus = add('bus', 'main_bus', 0, 220)
  const gen = add('generator', 'standby_generator', 380, -140, 0.48)
  const rmu = add('ring_main_unit', 'transfer_rmu', 380, 220, 0.48)
  const cable = add('cable', 'feeder_01', -160, 370, 0.48)
  const load = add('load', 'critical_load', 380, 450, 0.48)
  const load2 = add('load', 'building_load', -160, 530, 0.48)
  editor.resizeBus(bus, { ...editor.equipment.get(bus)!, bus_length: 560 })
  const connect = (a: string, portA: string, b: string, portB: string, tap?: number) =>
    editor.connect(
      { equipment_key: a, port_id: portA, ...(portA === 'bar' ? { tap_offset: tap ?? 0 } : {}) },
      { equipment_key: b, port_id: portB, ...(portB === 'bar' ? { tap_offset: tap ?? 0 } : {}) },
    )
  connect(utility, 'terminal', breaker, 'in')
  connect(breaker, 'out', transformer, 'primary')
  connect(transformer, 'secondary', bus, 'bar', -260)
  connect(bus, 'bar', rmu, 'left', 180)
  connect(gen, 'terminal', rmu, 'right')
  connect(rmu, 'feeder', load, 'terminal')
  connect(bus, 'bar', cable, 'in', -160)
  connect(cable, 'out', load2, 'terminal')
  editor.setFailover(rmu, [utility, breaker, transformer], gen)
  return editor.snapshot()
}

// Four 500-tap buses, 1,996 two-terminal components, exactly 2,500 connectors.
export function benchmarkDocument(): DocumentRecord {
  const d = emptyDocument('Performance fixture · 2,000 equipment / 2,500 connectors')
  const eq = (type: EquipmentType, index: number, x: number, y: number): EquipmentRecord => ({
    key: `bench_${index}`,
    id: `${type}_${index}`,
    equipment_type: type,
    x,
    y,
    rotation: 0,
    kv_rating: 13.8,
    amp_rating: 1200,
    derating_multiplier: 1,
    ...(type === 'bus' ? { bus_length: 12000 } : {}),
  })
  for (let i = 0; i < 4; i++) d.equipment.push(eq('bus', i, 3000, -220 - i * 100))
  for (let i = 0; i < 1996; i++)
    d.equipment.push(
      eq(
        i % 3 === 0 ? 'cable' : i % 3 === 1 ? 'hv_breaker' : 'dry_type_transformer',
        i + 4,
        (i % 50) * 120,
        Math.floor(i / 50) * 180,
      ),
    )
  const map = new Map(d.equipment.map((e) => [e.key, e]))
  const used = new Set<string>()
  const names = (e: EquipmentRecord) =>
    e.equipment_type === 'dry_type_transformer' ? ['primary', 'secondary'] : ['in', 'out']
  const connect = (
    a: EquipmentRecord,
    portA: string,
    b: EquipmentRecord,
    portB: string,
    tap?: number,
  ) => {
    const id = `connector_${d.connectors.length + 1}`
    const c: ConnectorRecord = {
      id,
      from: {
        equipment_key: a.key,
        port_id: portA,
        ...(portA === 'bar' ? { tap_offset: tap } : {}),
      },
      to: { equipment_key: b.key, port_id: portB },
      points: [],
      routing: 'auto',
      bends: [],
    }
    c.points = routeConnector(c, map)
    d.connectors.push(c)
    used.add(`${a.key}/${portA}`)
    used.add(`${b.key}/${portB}`)
  }
  for (let i = 0; i < 500; i++) {
    const a = d.equipment[4 + i * 2],
      b = d.equipment[5 + i * 2]
    connect(a, names(a)[1], b, names(b)[0])
  }
  let taps = 0
  for (const e of d.equipment.slice(4)) {
    const port = names(e).find((p) => !used.has(`${e.key}/${p}`))!
    connect(d.equipment[taps % 4], 'bar', e, port, -5990 + Math.floor(taps / 4) * 24)
    taps++
  }
  for (const e of d.equipment.slice(4)) {
    if (taps === 2000) break
    const port = names(e).find((p) => !used.has(`${e.key}/${p}`))
    if (port) {
      connect(d.equipment[taps % 4], 'bar', e, port, -5990 + Math.floor(taps / 4) * 24)
      taps++
    }
  }
  return d
}
