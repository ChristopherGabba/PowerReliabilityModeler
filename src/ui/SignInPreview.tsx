import { EquipmentSymbolPaths } from './EquipmentSymbol'
import { DIAGRAM_STROKE_WIDTH } from '../core/symbols'
import { useState } from 'react'
import { Download, FileJson2 } from 'lucide-react'
import { CATALOG } from '../core/catalog'
import { ports } from '../core/geometry'
import { signInExample } from './signInExample'

const { document, model } = signInExample
const labels: Record<string, string> = {
  utility_a: 'Utility A',
  utility_b: 'Utility B',
  transformer_a: 'Transformer A',
  transformer_b: 'Transformer B',
  main_a: 'Main A',
  main_b: 'Main B',
  tie_main: 'Tie',
  bus_a: 'Bus A',
  bus_b: 'Bus B',
  load_a: 'Load A',
  load_b: 'Load B',
}

function downloadExample() {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(model, null, 2)], { type: 'application/json' }),
  )
  const link = window.document.createElement('a')
  link.href = url
  link.download = 'main-tie-main.json'
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function JsonCode({ value }: { value: unknown }) {
  const tokens = JSON.stringify(value, null, 2).split(
    /("(?:\\.|[^"\\])*"\s*:|"(?:\\.|[^"\\])*"|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?)/g,
  )
  return (
    <code>
      {tokens.map((token, i) => {
        const kind = token.startsWith('"')
          ? token.endsWith(':')
            ? 'key'
            : 'string'
          : /^(?:-?\d|true|false|null)/.test(token)
            ? 'value'
            : 'punctuation'
        return (
          <span key={i} className={`json-${kind}`}>
            {token}
          </span>
        )
      })}
    </code>
  )
}

export function SignInPreview() {
  const [selected, setSelected] = useState('tie_main')
  const equipment = model.equipment.find((item) => item.id === selected)!
  const { id, equipment_type, ...properties } = equipment
  return (
    <section className="model-preview" aria-label="Main-tie-main electrical model and JSON preview">
      <div className="preview-heading">
        <div>
          <span className="preview-dot" />
          <h2>Main-tie-main</h2>
        </div>
        <span>Example model</span>
      </div>
      <div className="preview-drawing">
        <svg
          viewBox="0 -15 720 545"
          aria-label="Two utility supplies, each feeding a transformer, main breaker, bus and load. A tie breaker connects the buses."
        >
          <g fill="none" stroke="#788ca2" strokeWidth={DIAGRAM_STROKE_WIDTH} strokeLinejoin="round">
            {document.connectors.map((wire) => (
              <polyline key={wire.id} points={wire.points.map((p) => `${p.x},${p.y}`).join(' ')} />
            ))}
          </g>
          {document.equipment.map((item) => {
            const catalog = CATALOG[item.equipment_type]
            const active = selected === item.id
            const width = item.bus_length ?? catalog.width
            const isBus = item.equipment_type === 'bus'
            const below = isBus || item.id === 'tie_main' || item.equipment_type === 'load'
            return (
              <g
                key={item.key}
                className={`preview-equipment ${active ? 'is-selected' : ''}`}
                role="button"
                tabIndex={0}
                aria-label={`View ${labels[item.id]} JSON`}
                aria-pressed={active}
                onClick={() => setSelected(item.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    setSelected(item.id)
                  }
                }}
              >
                <g transform={`translate(${item.x} ${item.y}) rotate(${item.rotation})`}>
                  <rect
                    className="preview-hit"
                    x={-width / 2 - 9}
                    y={-catalog.height / 2 - 9}
                    width={width + 18}
                    height={catalog.height + 18}
                    rx="5"
                  />
                  <g color={active ? '#0088ff' : '#273d55'}>
                    <EquipmentSymbolPaths type={item.equipment_type} busLength={item.bus_length} />
                  </g>
                </g>
                {active &&
                  ports(item).map((port) => (
                    <circle
                      key={port.id}
                      cx={port.x}
                      cy={port.y}
                      r="3"
                      fill="white"
                      stroke="#0088ff"
                      strokeWidth={DIAGRAM_STROKE_WIDTH}
                    />
                  ))}
                <text
                  x={below ? item.x : item.x + catalog.width / 2 + 17}
                  y={below ? item.y + catalog.height / 2 + 25 : item.y + 4}
                  textAnchor={below ? 'middle' : 'start'}
                >
                  {labels[item.id]}
                </text>
              </g>
            )
          })}
        </svg>
        <p>Select a component to see its JSON.</p>
      </div>
      <div className="preview-json">
        <div className="preview-json-heading">
          <div>
            <FileJson2 size={16} />
            <span>main-tie-main.json</span>
            <span className="json-record">/ {equipment.id}</span>
          </div>
          <button
            onClick={downloadExample}
            aria-label="Download complete example JSON"
            title="Download complete example JSON"
          >
            <Download size={15} />
          </button>
        </div>
        <pre tabIndex={0} aria-label={`${equipment.id} equipment JSON`}>
          <JsonCode value={{ id, equipment_type, ...properties }} />
        </pre>
        <div className="preview-json-footer">
          <span>Equipment, connections & coordinates</span>
          <span>
            {model.equipment.length} components · {model.connectors.length} connectors
          </span>
        </div>
      </div>
    </section>
  )
}
