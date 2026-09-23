import { useEffect, useId, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import { CATALOG } from '../core/catalog'
import type { EquipmentRecord } from '../core/types'

export function EquipmentFinder({
  equipment,
  onChoose,
  onClose,
}: {
  equipment: ReadonlyMap<string, EquipmentRecord>
  onChoose: (key: string) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const listId = useId()
  const list = useRef<HTMLDivElement>(null)
  const term = query.trim().toLowerCase()
  const matches = term
    ? [...equipment.values()].filter((item) => item.id.toLowerCase().includes(term))
    : []
  matches.sort(
    (a, b) =>
      Number(b.id.toLowerCase() === term) - Number(a.id.toLowerCase() === term) ||
      a.id.localeCompare(b.id),
  )
  const results = matches.slice(0, 100)
  const index = Math.min(active, Math.max(0, results.length - 1))
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [index, query])
  return (
    <section
      className="equipment-finder"
      aria-label="Find equipment"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          onClose()
        }
      }}
    >
      <div className="finder-input">
        <Search size={17} />
        <input
          autoFocus
          role="combobox"
          aria-label="Find by equipment ID"
          aria-autocomplete="list"
          aria-expanded={!!term}
          aria-controls={listId}
          aria-activedescendant={results.length ? `${listId}-${index}` : undefined}
          placeholder="Find by equipment ID…"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setActive(0)
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              if (results.length)
                setActive(
                  (index + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length,
                )
            } else if (event.key === 'Enter') {
              event.preventDefault()
              if (results[index]) onChoose(results[index].key)
            }
          }}
        />
        <button className="icon-button" onClick={onClose} aria-label="Close find">
          <X size={16} />
        </button>
      </div>
      <div
        className="finder-results"
        ref={list}
        id={listId}
        role="listbox"
        aria-label="Matching equipment"
      >
        {results.map((item, i) => (
          <button
            key={item.key}
            id={`${listId}-${i}`}
            role="option"
            aria-selected={i === index}
            onClick={() => onChoose(item.key)}
            onFocus={() => setActive(i)}
          >
            <strong>{item.id}</strong>
            <span>{CATALOG[item.equipment_type].name}</span>
          </button>
        ))}
      </div>
      <p className="finder-hint" role="status">
        {!term
          ? 'Type an equipment ID or part of it.'
          : !matches.length
            ? 'No matching equipment.'
            : `${matches.length > 100 ? 'Showing first 100 of ' : ''}${matches.length} match${matches.length === 1 ? '' : 'es'} · ↑ ↓ to choose · Enter to locate`}
      </p>
    </section>
  )
}
