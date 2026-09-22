import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CanvasController } from '../src/canvas/controller'
import { Editor } from '../src/core/editor'
import { endpointPosition, localPoint, worldPoint } from '../src/core/geometry'
import type { Point } from '../src/core/types'

describe('Bus pointer interactions', () => {
  let editor: Editor
  let controller: CanvasController
  let host: HTMLDivElement
  let browserWindow: EventTarget

  beforeEach(() => {
    browserWindow = Object.assign(new EventTarget(), { closest: () => null })
    vi.stubGlobal('window', browserWindow)
    vi.stubGlobal('requestAnimationFrame', () => 1)
    vi.stubGlobal('cancelAnimationFrame', () => {})
    host = Object.assign(new EventTarget(), {
      style: {},
      focus: () => {},
      getBoundingClientRect: () => ({ left: 30, top: 50 }),
      setPointerCapture: () => {},
      hasPointerCapture: () => false,
    }) as unknown as HTMLDivElement
    vi.stubGlobal('document', { activeElement: host })
    editor = new Editor()
    editor.setViewport({ x: 137, y: 91, zoom: 1.7 })
    controller = new CanvasController(editor, host)
  })

  afterEach(() => {
    controller.dispose()
    vi.unstubAllGlobals()
  })

  function pointer(type: string, p: Point) {
    host.dispatchEvent(
      Object.assign(new Event(type, { cancelable: true }), {
        clientX: 30 + editor.viewport.x + p.x * editor.viewport.zoom,
        clientY: 50 + editor.viewport.y + p.y * editor.viewport.zoom,
        button: 0,
        pointerId: 1,
      }),
    )
  }

  function drag(from: Point, to: Point) {
    pointer('pointerdown', from)
    pointer('pointermove', to)
    pointer('pointerup', to)
  }

  it.each([0, 90, 180, 270].flatMap((rotation) => [-1, 1].map((side) => [rotation, side])))(
    'lands on a bus rotated %i° from side %i without crossing the bar',
    (rotation, side) => {
      const bus = editor.add('bus', { x: 0, y: 0 })
      for (let angle = 0; angle < rotation; angle += 90) editor.rotate()
      const bar = editor.equipment.get(bus)!
      const device = editor.add('utility_source', worldPoint(bar, { x: -50, y: side * 70 }))
      for (let angle = 0; angle < (rotation + (side === 1 ? 180 : 0)) % 360; angle += 90)
        editor.rotate()
      drag(
        endpointPosition(editor.equipment.get(device)!, { port_id: 'terminal' }),
        worldPoint(bar, { x: 30, y: 0 }),
      )
      expect(editor.connectors.size).toBe(1)
      const wire = [...editor.connectors.values()].at(-1)!
      expect(wire.to).toMatchObject({ equipment_key: bus, tap_offset: 30 })
      const path = wire.points.map((point) => localPoint(bar, point))
      expect(path.at(-1)!.x).toBeCloseTo(30)
      expect(path.at(-1)!.y).toBeCloseTo(0)
      expect(path.slice(0, -1).filter((point) => side * point.y <= 0)).toEqual([])
    },
  )

  it.each([0, 90, 180, 270])(
    'slides the connection along a bus rotated %i° when its device is dragged',
    (rotation) => {
      const bus = editor.add('bus', { x: 0, y: 0 })
      for (let angle = 0; angle < rotation; angle += 90) editor.rotate()
      const bar = editor.equipment.get(bus)!
      const origin = worldPoint(bar, { x: -50, y: -200 })
      const device = editor.add('utility_source', origin)
      for (let angle = 0; angle < rotation; angle += 90) editor.rotate()
      drag(
        endpointPosition(editor.equipment.get(device)!, { port_id: 'terminal' }),
        worldPoint(bar, { x: -50, y: 0 }),
      )
      const before = editor.snapshot()
      drag(origin, worldPoint(bar, { x: 40, y: -200 }))
      const wire = [...editor.connectors.values()][0]
      expect(wire.to.tap_offset).toBe(40)
      expect(wire.points).toEqual([
        worldPoint(bar, { x: 40, y: -162 }),
        worldPoint(bar, { x: 40, y: 0 }),
      ])
      const after = editor.snapshot()
      editor.undo()
      expect(editor.snapshot()).toEqual(before)
      editor.redo()
      expect(editor.snapshot()).toEqual(after)
    },
  )

  it.each([0, 90, 180, 270])(
    'moves a newly placed bus rotated %i° instead of starting a wire',
    (rotation) => {
      const bus = editor.add('bus', { x: 0, y: 0 })
      for (let angle = 0; angle < rotation; angle += 90) editor.rotate()
      pointer('pointerdown', { x: 0, y: 0 })
      expect(editor.preview?.kind).not.toBe('wire')
      pointer('pointermove', { x: 70, y: 40 })
      pointer('pointerup', { x: 70, y: 40 })
      expect(editor.equipment.get(bus)).toMatchObject({ x: 70, y: 40, bus_length: 200 })
      expect(editor.connectors.size).toBe(0)
      editor.undo()
      expect(editor.equipment.get(bus)).toMatchObject({ x: 0, y: 0 })
      editor.redo()
      expect(editor.equipment.get(bus)).toMatchObject({ x: 70, y: 40 })
    },
  )

  it('selects a bus by its bar and rotates it using the canvas shortcut', () => {
    const bus = editor.add('bus', { x: 0, y: 0 })
    editor.select([])
    pointer('pointerdown', { x: 60, y: 0 })
    pointer('pointerup', { x: 60, y: 0 })
    expect(editor.selection).toEqual(new Set([bus]))
    browserWindow.dispatchEvent(Object.assign(new Event('keydown'), { key: 'r', ctrlKey: true }))
    expect(editor.equipment.get(bus)!.rotation).toBe(90)
  })

  it.each([0, 90, 180, 270])(
    'receives wires and preserves their taps when moving and resizing at %i°',
    (rotation) => {
      const device = editor.add('utility_source', { x: -300, y: -200 })
      const bus = editor.add('bus', { x: 0, y: 0 })
      for (let angle = 0; angle < rotation; angle += 90) editor.rotate()
      const from = endpointPosition(editor.equipment.get(device)!, {
        port_id: 'terminal',
      })
      const tap = worldPoint(editor.equipment.get(bus)!, { x: 30, y: 0 })
      drag(from, tap)
      expect(editor.connectors.size).toBe(1)
      const connectorId = [...editor.connectors.keys()][0]
      expect(editor.connectors.get(connectorId)!.to).toMatchObject({
        equipment_key: bus,
        port_id: 'bar',
        tap_offset: 30,
      })

      drag({ x: 0, y: 0 }, { x: 70, y: 40 })
      const moved = editor.equipment.get(bus)!
      expect(moved).toMatchObject({ x: 70, y: 40 })
      const { x, y } = endpointPosition(moved, editor.connectors.get(connectorId)!.to)
      const movedTap = { x, y }
      expect(editor.connectors.get(connectorId)!.points.at(-1)).toEqual(movedTap)

      for (const side of [-1, 1]) {
        const item = editor.equipment.get(bus)!
        const end = worldPoint(item, { x: (side * item.bus_length!) / 2, y: 0 })
        const extended = worldPoint(item, { x: side * (item.bus_length! / 2 + 60), y: 0 })
        drag(end, extended)
        expect(editor.equipment.get(bus)!.bus_length).toBeCloseTo(item.bus_length! + 60)
        expect(editor.connectors.get(connectorId)!.points.at(-1)).toEqual(movedTap)
      }
      expect(editor.connectors.size).toBe(1)
    },
  )
})
