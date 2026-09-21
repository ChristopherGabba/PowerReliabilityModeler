import { Editor } from '../core/editor'
import { exportModel } from '../core/schema'
import { emptyDocument, type EquipmentType } from '../core/types'

// The drawing and downloadable JSON share one valid model.
function makeExample() {
  const editor = new Editor(emptyDocument('Main-tie-main'))
  editor.updateHeader({ model_date: '2026-09-21' })
  const add = (type: EquipmentType, id: string, x: number, y: number, kv = 0.48) => {
    const key = editor.add(type, { x, y })
    editor.update(key, { id, kv_rating: kv, amp_rating: 1200 })
    return key
  }
  const connect = (a: string, portA: string, b: string, portB: string, tap = 0) =>
    editor.connect(
      { equipment_key: a, port_id: portA, ...(portA === 'bar' ? { tap_offset: tap } : {}) },
      { equipment_key: b, port_id: portB, ...(portB === 'bar' ? { tap_offset: tap } : {}) },
    )
  const buses: string[] = []
  for (const [side, x] of [
    ['a', 160],
    ['b', 560],
  ] as const) {
    const utility = add('utility_source', `utility_${side}`, x, 40, 13.8)
    const transformer = add('dry_type_transformer', `transformer_${side}`, x, 145, 13.8)
    const main = add('indoor_drawout_breaker', `main_${side}`, x, 250)
    const bus = add('bus', `bus_${side}`, x, 340)
    const load = add('load', `load_${side}`, x, 465)
    editor.resizeBus(bus, { ...editor.equipment.get(bus)!, bus_length: 180 })
    connect(utility, 'terminal', transformer, 'primary')
    connect(transformer, 'secondary', main, 'in')
    connect(main, 'out', bus, 'bar')
    connect(bus, 'bar', load, 'terminal')
    buses.push(bus)
  }
  const tie = add('indoor_drawout_breaker', 'tie_main', 360, 340)
  for (let turn = 0; turn < 3; turn++) editor.rotate(new Set([tie]))
  connect(buses[0], 'bar', tie, 'in', 90)
  connect(tie, 'out', buses[1], 'bar', -90)
  return { document: editor.snapshot(), model: exportModel(editor.snapshot()) }
}

export const signInExample = makeExample()
