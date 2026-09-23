import { X } from 'lucide-react'
import type { ExportIssue } from '../core/exportChecks'

export function ExportErrors({
  issues,
  onChoose,
  onClose,
}: {
  issues: ExportIssue[]
  onChoose: (key: string) => void
  onClose: () => void
}) {
  return (
    <div className="modal-backdrop">
      <div
        className="modal export-errors"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="export-errors-title"
        aria-describedby="export-errors-description"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onClose()
          }
          if (event.key === 'Tab') {
            const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')]
            const next = event.shiftKey ? buttons.at(-1) : buttons[0]
            const edge = event.shiftKey ? buttons[0] : buttons.at(-1)
            if (document.activeElement === edge) {
              event.preventDefault()
              next?.focus()
            }
          }
        }}
      >
        <div className="modal-heading">
          <h2 id="export-errors-title">Complete the model before exporting</h2>
          <button className="icon-button" onClick={onClose} aria-label="Close export checks">
            <X size={18} />
          </button>
        </div>
        <p id="export-errors-description">
          {issues.length} component{issues.length === 1 ? ' needs' : 's need'} attention. Every
          component needs voltage (kV) and current (A). Double-click an error to locate its
          component and open its properties, or focus the error and press Enter.
        </p>
        <div className="export-error-list">
          {issues.map((issue, index) => (
            <button
              key={issue.key}
              autoFocus={index === 0}
              onDoubleClick={() => onChoose(issue.key)}
              onClick={(event) => {
                if (event.detail === 0) onChoose(issue.key)
              }}
            >
              <strong>{issue.id}</strong>
              <span>{issue.message}</span>
            </button>
          ))}
        </div>
        <div className="modal-actions">
          <button className="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
