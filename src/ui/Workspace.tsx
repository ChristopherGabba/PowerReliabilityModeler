import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import {
  ArrowLeft,
  Check,
  ChevronDown,
  CircleHelp,
  Cloud,
  CloudOff,
  Copy,
  Download,
  Expand,
  Group,
  Hand,
  Minus,
  MousePointer2,
  Plus,
  Redo2,
  RotateCw,
  Settings2,
  Trash2,
  Undo2,
  Ungroup,
  X,
  Zap,
} from 'lucide-react'
import { CanvasController } from '../canvas/controller'
import { CanvasRenderer } from '../canvas/renderer'
import type { Editor } from '../core/editor'
import { CATALOG } from '../core/catalog'
import { EQUIPMENT_TYPES } from '../core/types'
import type { ProjectSession } from '../persistence/session'
import { Inspector } from './Inspector'
import { ArrangementControls } from './ArrangementControls'
import { errorMessage } from '../core/schema'

export function downloadJson(text: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `${name.replace(/[^a-zA-Z0-9_-]+/g, '-') || 'model'}.json`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
function Action({
  label,
  onClick,
  children,
  disabled = false,
  active = false,
}: {
  label: string
  onClick: () => void
  children: ReactNode
  disabled?: boolean
  active?: boolean
}) {
  return (
    <button
      className={`icon-button ${active ? 'active' : ''}`}
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  )
}
export function Workspace({
  editor: e,
  session,
  onBack,
  userControl,
  local,
}: {
  editor: Editor
  session: ProjectSession
  onBack: () => void
  userControl: ReactNode
  local: boolean
}) {
  useSyncExternalStore(e.subscribe, e.getSnapshot)
  useSyncExternalStore(session.subscribe, session.getSnapshot)
  const host = useRef<HTMLDivElement>(null),
    controller = useRef<CanvasController | null>(null),
    renderer = useRef<CanvasRenderer | null>(null)
  const [ready, setReady] = useState(false),
    [error, setError] = useState(''),
    [settings, setSettings] = useState(false),
    [help, setHelp] = useState(false),
    [exporting, setExporting] = useState(false)
  useEffect(() => {
    let active = true
    const surface = new CanvasRenderer(e, host.current!),
      input = new CanvasController(e, host.current!)
    renderer.current = surface
    controller.current = input
    surface
      .initialize(
        new URLSearchParams(location.search).get('renderer') === 'webgpu' ? 'webgpu' : 'webgl',
      )
      .then(() => {
        if (!active) return
        setReady(true)
        if (e.viewport.x === 0 && e.viewport.y === 0) input.fit()
        input.focus()
        if (import.meta.env.DEV)
          (window as any).__PSMTJ__ = { editor: e, renderer: surface, controller: input, session }
      })
      .catch((err) => {
        if (active) setError(errorMessage(err))
      })
    return () => {
      active = false
      input.dispose()
      surface.dispose()
      if (import.meta.env.DEV) delete (window as any).__PSMTJ__
    }
  }, [e, session])
  const act = (fn: () => void) => () => {
    try {
      fn()
      controller.current?.focus()
    } catch (err) {
      e.message(errorMessage(err))
    }
  }
  const focus = (key: string) => {
    const item = e.equipment.get(key)
    if (!item || !host.current) return
    e.inspector = key
    e.select([key], false)
    const v = e.viewport
    e.setViewport(
      {
        ...v,
        x: host.current.clientWidth / 2 - item.x * v.zoom,
        y: host.current.clientHeight / 2 - item.y * v.zoom,
      },
      true,
    )
  }
  async function exportFile() {
    setExporting(true)
    try {
      downloadJson(await session.export(), e.header.model_name)
    } catch (err) {
      e.message(errorMessage(err))
    } finally {
      setExporting(false)
    }
  }
  const selected = e.selection.size
  const inspectorOpen = !!((e.inspector && e.equipment.has(e.inspector)) || e.selectedConnector)
  return (
    <div className="workspace">
      <header className="workspace-header">
        <div className="header-left">
          <button className="brand-mark" onClick={onBack} aria-label="Back to models">
            <Zap size={21} fill="currentColor" />
          </button>
          <button className="breadcrumb" onClick={onBack}>
            <ArrowLeft size={13} />
            Models
          </button>
          <span className="breadcrumb-slash">/</span>
          <button className="project-title" onClick={() => setSettings(true)}>
            {e.header.model_name}
            <ChevronDown size={14} />
          </button>
          <span className="revision-pill">Rev {e.header.model_revision || '—'}</span>
        </div>
        <div className="header-right">
          <span
            className={`save-status ${session.status === 'error' ? 'has-error' : ''}`}
            title={session.error || 'Changes save automatically'}
          >
            {session.status === 'offline' ? (
              <CloudOff size={14} />
            ) : session.status === 'error' ? (
              <span className="status-dot error" />
            ) : session.status === 'saving' ? (
              <span className="status-dot saving" />
            ) : (
              <Check size={14} />
            )}
            <span>
              {session.status === 'saved'
                ? 'All changes saved'
                : session.status === 'local'
                  ? 'Saved on this device'
                  : session.status === 'saving'
                    ? 'Saving'
                    : session.status === 'offline'
                      ? 'Offline · saved locally'
                      : 'Save needs attention'}
            </span>
          </span>
          <span className="header-divider" />
          <Action label="Model details" onClick={() => setSettings(true)}>
            <Settings2 size={17} />
          </Action>
          <Action label="Keyboard shortcuts" onClick={() => setHelp(true)}>
            <CircleHelp size={17} />
          </Action>
          <button className="button export-button" onClick={exportFile} disabled={exporting}>
            <Download size={15} />
            {exporting ? 'Preparing…' : 'Export JSON'}
          </button>
          {userControl}
        </div>
      </header>
      <div className="editor-body">
        <main className="canvas-area">
          <div
            ref={host}
            className="canvas-host"
            tabIndex={0}
            role="application"
            aria-label="Electrical one-line canvas. Select equipment from the bottom palette. Press question mark help button for keyboard shortcuts."
          />
          {!ready && !error && (
            <div className="canvas-loading">
              <span className="spinner" />
              Opening canvas
            </div>
          )}
          {error && (
            <div className="canvas-loading">
              <h2>Canvas could not start</h2>
              <p>{error}</p>
              <button className="button" onClick={() => location.reload()}>
                Reload
              </button>
            </div>
          )}
          {ready && !e.equipment.size && (
            <div className="empty-canvas">
              <div className="empty-network">
                <span />
                <span />
                <span />
              </div>
              <h1>
                Every reliable system
                <br />
                starts with a connection.
              </h1>
              <p>
                Choose equipment below, then click anywhere to place it.
                <br />
                Drag between terminals to build your one-line.
              </p>
              <span className="empty-hint">Your canvas. Your model.</span>
            </div>
          )}
          <div className="canvas-top-left">
            <span className="document-chip">
              <span className="tiny-dot blue" />
              ONE-LINE MODEL
            </span>
            {local && <span className="local-label">LOCAL DEVELOPMENT</span>}
          </div>
          {selected > 0 && !e.failoverPick && (
            <div className="selection-toolbar">
              <div className="selection-actions">
                <span>{selected} selected</span>
                <span className="toolbar-divider" />
                <Action label="Duplicate · Ctrl/Cmd D" onClick={act(() => e.duplicate())}>
                  <Copy size={15} />
                </Action>
                <Action label="Rotate · Ctrl R" onClick={act(() => e.rotate())}>
                  <RotateCw size={15} />
                </Action>
                <Action
                  label="Group · Ctrl/Cmd G"
                  onClick={act(() => e.group())}
                  disabled={selected < 2}
                >
                  <Group size={16} />
                </Action>
                <Action label="Ungroup · Ctrl/Cmd Shift G" onClick={act(() => e.ungroup())}>
                  <Ungroup size={16} />
                </Action>
                <Action label="Delete selection" onClick={act(() => e.deleteSelection())}>
                  <Trash2 size={15} />
                </Action>
              </div>
              {selected > 1 && (
                <ArrangementControls
                  editor={e}
                  onAction={(action) => act(() => e.arrange(action))()}
                />
              )}
            </div>
          )}
          {e.failoverPick && (
            <div className="failover-banner">
              <span className="pick-indicator" />
              <div>
                <strong>
                  {e.failoverPick.kind === 'triggers'
                    ? 'Select failover triggers'
                    : 'Choose a Failover Target'}
                </strong>
                <p>
                  For {e.equipment.get(e.failoverPick.owner)?.id} · {e.failoverPick.keys.size}{' '}
                  selected
                </p>
              </div>
              <button
                className="button"
                onClick={() => {
                  e.failoverPick = null
                  e.notify()
                }}
              >
                Cancel
              </button>
              <button className="button primary" onClick={act(() => e.applyFailoverPick())}>
                Apply
              </button>
            </div>
          )}
          <div className="bottom-tools">
            <div className="tool-cluster">
              <Action
                label="Select · V"
                onClick={act(() => e.setTool('select'))}
                active={e.tool === 'select'}
              >
                <MousePointer2 size={18} />
              </Action>
              <Action
                label="Hand · H / hold Space"
                onClick={act(() => e.setTool('hand'))}
                active={e.tool === 'hand'}
              >
                <Hand size={18} />
              </Action>
              <span className="toolbar-divider" />
              <Action label="Undo · Ctrl/Cmd Z" onClick={act(() => e.undo())} disabled={!e.canUndo}>
                <Undo2 size={18} />
              </Action>
              <Action
                label="Redo · Ctrl/Cmd Shift Z"
                onClick={act(() => e.redo())}
                disabled={!e.canRedo}
              >
                <Redo2 size={18} />
              </Action>
            </div>
            <div className="equipment-palette" aria-label="Equipment palette">
              {EQUIPMENT_TYPES.map((type) => (
                <button
                  key={type}
                  className={`palette-item ${e.tool === 'place' && e.placement === type ? 'active' : ''}`}
                  onClick={act(() => e.setTool('place', type))}
                  aria-label={`Place ${CATALOG[type].name}`}
                  title={`${CATALOG[type].name} — click to place`}
                >
                  <img src={`/symbols/${type}.png`} alt="" />
                  <span className="palette-tooltip">{CATALOG[type].short}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="canvas-footer">
            <div className="model-count">
              <span>{e.equipment.size} equipment</span>
              <span>·</span>
              <span>{e.connectors.size} connectors</span>
            </div>
            <span className="canvas-instruction">
              {e.tool === 'place'
                ? `Click to place ${CATALOG[e.placement].name.toLowerCase()} · Shift to keep placing`
                : e.failoverPick
                  ? 'Click equipment or drag to select'
                  : selected
                    ? 'Double-click to edit · Alt-drag to duplicate'
                    : 'Drag to select · Space to pan · Ctrl + scroll to zoom'}
            </span>
            <div className="zoom-controls">
              <Action label="Zoom out" onClick={act(() => controller.current?.zoom(1 / 1.2))}>
                <Minus size={14} />
              </Action>
              <button className="zoom-value" onClick={act(() => controller.current?.fit())}>
                {Math.round(e.viewport.zoom * 100)}%
              </button>
              <Action label="Zoom in" onClick={act(() => controller.current?.zoom(1.2))}>
                <Plus size={14} />
              </Action>
              <span className="toolbar-divider" />
              <Action label="Fit model · F" onClick={act(() => controller.current?.fit())}>
                <Expand size={14} />
              </Action>
            </div>
          </div>
        </main>
        {inspectorOpen && (
          <Inspector
            editor={e}
            onFocus={focus}
            onClose={() => {
              e.inspector = null
              e.selectedConnector = null
              e.notify()
              controller.current?.focus()
            }}
          />
        )}
      </div>
      {(e.notice || session.error) && (
        <div className="toast" role="status">
          <span>{e.notice || session.error}</span>
          <button
            className="icon-button"
            aria-label="Dismiss message"
            onClick={() => {
              e.notice = ''
              session.dismissError()
              e.notify()
            }}
          >
            <X size={15} />
          </button>
        </div>
      )}
      {settings && (
        <ModelDetails
          editor={e}
          onClose={() => {
            setSettings(false)
            controller.current?.focus()
          }}
        />
      )}
      {help && (
        <div className="modal-backdrop" onMouseDown={() => setHelp(false)}>
          <div
            className="modal shortcuts"
            role="dialog"
            aria-modal="true"
            aria-label="Keyboard shortcuts"
            onMouseDown={(ev) => ev.stopPropagation()}
          >
            <div className="modal-heading">
              <h2>A few useful shortcuts</h2>
              <button
                className="icon-button"
                onClick={() => setHelp(false)}
                aria-label="Close shortcuts"
              >
                <X size={18} />
              </button>
            </div>
            {[
              ['Select', 'V'],
              ['Pan', 'Hold Space / H'],
              ['Add to selection', 'Shift + click / drag'],
              ['Duplicate', 'Alt + drag / Ctrl/Cmd + D'],
              ['Duplicate while dragging', 'Ctrl/Cmd + Shift + drag'],
              ['Rotate 90°', 'Ctrl + R'],
              ['Group / ungroup', 'Ctrl/Cmd + G / + Shift'],
              ['Copy / paste', 'Ctrl/Cmd + C / V'],
              ['Undo / redo', 'Ctrl/Cmd + Z / + Shift'],
              ['Select all', 'Ctrl/Cmd + A'],
              ['Fit to model', 'F'],
              ['Cancel', 'Escape'],
            ].map(([name, key]) => (
              <div className="shortcut-row" key={name}>
                <span>{name}</span>
                <kbd>{key}</kbd>
              </div>
            ))}
            <p className="muted">
              Click the canvas to focus keyboard controls. Equipment fields keep their normal
              text-editing shortcuts.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
function ModelDetails({ editor: e, onClose }: { editor: Editor; onClose: () => void }) {
  const [name, setName] = useState(e.header.model_name),
    [revision, setRevision] = useState(e.header.model_revision),
    [date, setDate] = useState(e.header.model_date),
    [error, setError] = useState('')
  return (
    <div className="modal-backdrop">
      <form
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Model details"
        onSubmit={(ev) => {
          ev.preventDefault()
          try {
            e.updateHeader({ model_name: name, model_revision: revision, model_date: date })
            onClose()
          } catch (err) {
            setError(errorMessage(err))
          }
        }}
      >
        <div className="modal-heading">
          <div>
            <span className="eyebrow">PROJECT</span>
            <h2>Model details</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="Close model details"
          >
            <X size={18} />
          </button>
        </div>
        <label className="field">
          <span>Model name</span>
          <input autoFocus value={name} onChange={(ev) => setName(ev.target.value)} required />
        </label>
        <div className="field-grid">
          <label className="field">
            <span>Engineering revision</span>
            <input value={revision} onChange={(ev) => setRevision(ev.target.value)} />
          </label>
          <label className="field">
            <span>Model date</span>
            <input type="date" value={date} onChange={(ev) => setDate(ev.target.value)} required />
          </label>
        </div>
        <p className="muted">Revision and date are yours to set. Autosave does not change them.</p>
        {error && <p className="field-error">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" type="submit">
            Save details
          </button>
        </div>
      </form>
    </div>
  )
}
