import { describe, expect, it } from 'vitest'
import { Editor } from '../src/core/editor'
import { exportModel, importModel, validateDocument } from '../src/core/schema'

function fixture(reverse = false, tap = -50) {
  const editor = new Editor()
  const bus = editor.add('bus', { x: 0, y: 0 })
  const device = editor.add('utility_source', { x: -50, y: -200 })
  const terminal = { equipment_key: device, port_id: 'terminal' }
  const bar = { equipment_key: bus, port_id: 'bar', tap_offset: tap }
  const id = editor.connect(reverse ? bar : terminal, reverse ? terminal : bar)!
  const connection = () => editor.connectors.get(id)!
  const attachment = () => (reverse ? connection().from : connection().to)
  return { editor, bus, device, id, connection, attachment }
}

describe('Bus connection movement', () => {
  it.each([false, true])('follows the device with a reversed connector: %s', (reverse) => {
    const { editor, device, attachment } = fixture(reverse)
    editor.move(new Set([device]), 90, 0)
    expect(attachment().tap_offset).toBe(40)
    const model = exportModel(editor.snapshot())
    expect(exportModel(importModel(model))).toEqual(model)
  })

  it('preserves an intentionally offset attachment as the device moves', () => {
    const { editor, device, attachment } = fixture(false, -20)
    editor.move(new Set([device]), 40, 30)
    expect(attachment().tap_offset).toBe(20)
    validateDocument(editor.snapshot())
  })

  it('keeps the attachment on the bar and follows the device back from either end', () => {
    const { editor, device, attachment } = fixture()
    for (const [x, tap] of [
      [300, 100],
      [40, 40],
      [-300, -100],
      [-40, -40],
    ]) {
      editor.move(new Set([device]), x - editor.equipment.get(device)!.x, 0)
      expect(attachment().tap_offset).toBe(tap)
      validateDocument(editor.snapshot())
    }
  })

  it('keeps local taps when moving the bus alone or together with its device', () => {
    const { editor, bus, device, attachment } = fixture()
    editor.move(new Set([bus]), 20, 40)
    expect(attachment().tap_offset).toBe(-50)
    editor.move(new Set([bus, device]), 60, 80)
    expect(attachment().tap_offset).toBe(-50)
    validateDocument(editor.snapshot())
  })

  it('moves only the connected tap and preserves manually edited bends', () => {
    const { editor, bus, device, id, connection, attachment } = fixture()
    const load = editor.add('load', { x: 60, y: 150 })
    const otherId = editor.connect(
      { equipment_key: load, port_id: 'terminal' },
      { equipment_key: bus, port_id: 'bar', tap_offset: 60 },
    )!
    const other = editor.connectors.get(otherId)
    const bends = [
      { x: -50, y: -80 },
      { x: -20, y: -80 },
    ]
    editor.setBends(id, bends)
    editor.move(new Set([device]), 40, 0)
    expect(attachment().tap_offset).toBe(-10)
    expect(connection().bends).toEqual(bends)
    expect(editor.connectors.get(otherId)).toEqual(other)
    validateDocument(editor.snapshot())
  })
})
