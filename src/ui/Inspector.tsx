import { EquipmentSymbol } from './EquipmentSymbol'
import { mvaLabel } from '../core/labels'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { ArrowRight, Crosshair, RotateCw, Trash2, X, Zap, Cable, GitBranch } from 'lucide-react'
import type { Editor } from '../core/editor'
import { CATALOG } from '../core/catalog'
import { errorMessage } from '../core/schema'

function Field({
  label,
  value,
  onCommit,
  type = 'text',
  placeholder,
}: {
  label: string
  value: string
  onCommit: (value: string) => void
  type?: string
  placeholder?: string
}) {
  const [draft, setDraft] = useState(value),
    [error, setError] = useState('')
  useEffect(() => {
    setDraft(value)
    setError('')
  }, [value])
  function commit() {
    if (draft === value) return
    try {
      onCommit(draft)
      setError('')
    } catch (e) {
      setError(errorMessage(e))
    }
  }
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type={type}
        step={type === 'number' ? 'any' : undefined}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') {
            setDraft(value)
            e.currentTarget.blur()
          }
        }}
        aria-invalid={!!error}
      />
      {error && <small className="field-error">{error}</small>}
    </label>
  )
}
export function Inspector({
  editor: e,
  onClose,
  onFocus,
}: {
  editor: Editor
  onClose: () => void
  onFocus: (key: string) => void
}) {
  useSyncExternalStore(e.subscribe, e.getSnapshot)
  const item = e.inspector ? e.equipment.get(e.inspector) : null
  const connector = e.selectedConnector ? e.connectors.get(e.selectedConnector) : null
  const [search, setSearch] = useState(''),
    [searching, setSearching] = useState(false)
  useEffect(() => {
    setSearch('')
    setSearching(false)
  }, [item?.key])
  if (!item && !connector) return null
  if (connector) {
    const from = e.equipment.get(connector.from.equipment_key)!,
      to = e.equipment.get(connector.to.equipment_key)!
    return (
      <aside className="inspector">
        <div className="inspector-heading">
          <span className="eyebrow">CONNECTOR</span>
          <button className="icon-button" aria-label="Close inspector" onClick={onClose}>
            <X size={17} />
          </button>
        </div>
        <div className="equipment-heading">
          <div className="equipment-icon">
            <Cable size={25} />
          </div>
          <div>
            <h2>Connection</h2>
            <p>{connector.routing === 'auto' ? 'Automatic routing' : 'Manual route'}</p>
          </div>
        </div>
        <section>
          <h3>Endpoints</h3>
          <button className="connection-row" onClick={() => onFocus(from.key)}>
            {from.id}
            <small>{connector.from.port_id}</small>
          </button>
          <ArrowRight size={14} />
          <button className="connection-row" onClick={() => onFocus(to.key)}>
            {to.id}
            <small>{connector.to.port_id}</small>
          </button>
        </section>
        <section>
          <h3>Path</h3>
          <p className="muted">Drag a blue handle to adjust a segment.</p>
          <div className="coordinates">
            {connector.points.map((p, i) => (
              <div key={i}>
                <span>
                  {i === 0 ? 'Start' : i === connector.points.length - 1 ? 'End' : `Bend ${i}`}
                </span>
                <code>
                  {p.x.toFixed(0)}, {p.y.toFixed(0)}
                </code>
              </div>
            ))}
          </div>
          <button className="button full" onClick={() => e.setBends(connector.id, [])}>
            Reset automatic route
          </button>
        </section>
      </aside>
    )
  }
  if (!item) return null
  const catalog = CATALOG[item.equipment_type],
    failover = e.failovers.find((f) => f.equipment_key === item.key),
    connections = [...(e.adjacency.get(item.key) ?? [])].map((id) => e.connectors.get(id)!)
  const incomplete = failover && (!failover.parent_key || !failover.trigger_keys.length)
  const setParent = (key: string | null) =>
    e.setFailover(item.key, failover?.trigger_keys ?? [], key)
  const matches = search
    ? [...e.equipment.values()]
        .filter(
          (other) =>
            other.key !== item.key && other.id.toLowerCase().includes(search.toLowerCase()),
        )
        .slice(0, 15)
    : []
  return (
    <aside className="inspector">
      <div className="inspector-heading">
        <span className="eyebrow">EQUIPMENT PROPERTIES</span>
        <button className="icon-button" aria-label="Close inspector" onClick={onClose}>
          <X size={17} />
        </button>
      </div>
      <div className="equipment-heading">
        <div className="equipment-icon">
          <EquipmentSymbol type={item.equipment_type} />
        </div>
        <div>
          <h2>{catalog.name}</h2>
          <p>{catalog.description}</p>
        </div>
      </div>
      <section key={`${item.key}:identity`}>
        <Field label="Equipment ID" value={item.id} onCommit={(id) => e.update(item.key, { id })} />
        <div className="field">
          <span>Equipment type</span>
          <code className="type-value">{item.equipment_type}</code>
        </div>
      </section>
      <section key={`${item.key}:ratings`}>
        <h3>
          <Zap size={14} /> Ratings
        </h3>
        <div className="field-grid">
          <Field
            label="Voltage · kV"
            type="number"
            value={item.kv_rating?.toString() ?? ''}
            placeholder="Not set"
            onCommit={(value) =>
              e.update(item.key, { kv_rating: value === '' ? null : Number(value) })
            }
          />
          <Field
            label="Current · A"
            type="number"
            value={item.amp_rating?.toString() ?? ''}
            placeholder="Not set"
            onCommit={(value) =>
              e.update(item.key, { amp_rating: value === '' ? null : Number(value) })
            }
          />
        </div>
        <Field
          label="Derating multiplier"
          type="number"
          value={String(item.derating_multiplier)}
          onCommit={(value) => e.update(item.key, { derating_multiplier: Number(value) })}
        />
        <div className="field" title="Three-phase: √3 × kV × amps ÷ 1,000 × derating multiplier">
          <span>Derated capacity · three-phase</span>
          <strong>{mvaLabel(item)}</strong>
        </div>
      </section>
      <section>
        <div className="section-heading">
          <h3>
            <GitBranch size={14} /> Failover
          </h3>
          <span className={`badge ${failover && !incomplete ? 'green' : ''}`}>
            {!failover ? 'Not configured' : incomplete ? 'Incomplete' : 'Configured'}
          </span>
        </div>
        <p className="muted">
          If any selected equipment fails, switch this item to its failover target. Triggers appear
          orange when this item is selected.
        </p>
        <button className="button full" onClick={() => e.startFailoverPick(item.key, 'triggers')}>
          <Crosshair size={15} />
          Select failovers
          {failover?.trigger_keys.length ? ` (${failover.trigger_keys.length})` : ''}
        </button>
        {!!failover?.trigger_keys.length && (
          <div className="trigger-list">
            {failover.trigger_keys.map((key) => (
              <div className="trigger" key={key}>
                <span className="tiny-dot" />
                <button onClick={() => onFocus(key)}>{e.equipment.get(key)?.id}</button>
                <button
                  aria-label={`Remove trigger ${e.equipment.get(key)?.id}`}
                  onClick={() =>
                    e.setFailover(
                      item.key,
                      failover.trigger_keys.filter((k) => k !== key),
                      failover.parent_key,
                    )
                  }
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
        <label className="field">
          <span>Failover Target</span>
          <div className="parent-input">
            <input
              value={
                searching
                  ? search
                  : failover?.parent_key
                    ? (e.equipment.get(failover.parent_key)?.id ?? '')
                    : ''
              }
              placeholder="Search equipment ID…"
              onFocus={() => {
                setSearching(true)
                setSearch('')
              }}
              onBlur={() => setTimeout(() => setSearching(false), 150)}
              onChange={(ev) => setSearch(ev.target.value)}
            />
            <button
              className="icon-button"
              title="Pick Failover Target on canvas"
              aria-label="Pick Failover Target on canvas"
              onClick={() => e.startFailoverPick(item.key, 'parent')}
            >
              <Crosshair size={15} />
            </button>
          </div>
        </label>
        {search && (
          <div className="search-results">
            {matches.map((other) => (
              <button
                key={other.key}
                onClick={() => {
                  setParent(other.key)
                  setSearch('')
                  setSearching(false)
                }}
              >
                {other.id}
                <small>{CATALOG[other.equipment_type].short}</small>
              </button>
            ))}
            {!matches.length && <p>No matching equipment</p>}
          </div>
        )}
        {incomplete && (
          <p className="inline-warning">
            Choose at least one trigger and a failover target before exporting.
          </p>
        )}
        {failover && (
          <button className="text-button danger" onClick={() => e.removeFailover(item.key)}>
            Remove failover
          </button>
        )}
      </section>
      <section>
        <h3>
          <Cable size={14} /> Connections <span className="count">{connections.length}</span>
        </h3>
        {connections.map((c) => {
          const local = c.from.equipment_key === item.key ? c.from : c.to,
            other = c.from.equipment_key === item.key ? c.to : c.from,
            target = e.equipment.get(other.equipment_key)!
          return (
            <button className="connection-row" key={c.id} onClick={() => onFocus(target.key)}>
              <span>
                <small>{local.port_id}</small>
                <ArrowRight size={12} />
                {target.id}
              </span>
              <span className="port-tag">{other.port_id}</span>
            </button>
          )
        })}
        {!connections.length && <p className="muted">Drag from a terminal to connect equipment.</p>}
      </section>
      <section>
        <h3>On the canvas</h3>
        <div className="coordinates">
          <div>
            <span>X</span>
            <code>{item.x.toFixed(1)}</code>
          </div>
          <div>
            <span>Y</span>
            <code>{item.y.toFixed(1)}</code>
          </div>
          <div>
            <span>Rotation</span>
            <code>{item.rotation}°</code>
          </div>
        </div>
        <div className="two-buttons">
          <button className="button" onClick={() => e.rotate(new Set([item.key]))}>
            <RotateCw size={14} />
            Rotate
          </button>
          <button
            className="button danger"
            onClick={() => {
              e.select([item.key], false)
              e.deleteSelection()
            }}
          >
            <Trash2 size={14} />
            Delete
          </button>
        </div>
      </section>
    </aside>
  )
}
