import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ClerkProvider, SignIn, UserButton, useAuth } from '@clerk/react'
import {
  ArrowRight,
  ChevronRight,
  Copy,
  FileJson2,
  FolderOpen,
  MoreHorizontal,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  X,
  Zap,
} from 'lucide-react'
import { Editor } from './core/editor'
import { emptyDocument, uid, type DocumentRecord, type ProjectSummary } from './core/types'
import { exampleDocument, benchmarkDocument } from './core/fixtures'
import { errorMessage } from './core/schema'
import { ApiError, ProjectApi } from './persistence/api'
import { localProjects, loadLocal, removeLocal } from './persistence/local'
import { ModelWorker, ProjectSession } from './persistence/session'
import { Workspace } from './ui/Workspace'
import { SignInPreview } from './ui/SignInPreview'

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY
const localDevelopment = import.meta.env.DEV && import.meta.env.VITE_LOCAL_DEMO === 'true'
export default function App() {
  if (localDevelopment)
    return (
      <Client
        owner="local-development"
        api={null}
        userControl={
          <div className="avatar" title="Local development">
            CG
          </div>
        }
      />
    )
  if (!publishableKey)
    return (
      <SignInPage>
        <p className="auth-unavailable">Sign-in is being configured. Please try again shortly.</p>
      </SignInPage>
    )
  return (
    <ClerkProvider
      publishableKey={publishableKey}
      localization={{ signIn: { start: { title: 'Sign in', subtitle: '' } } }}
      appearance={{
        variables: {
          colorPrimary: '#0088ff',
          fontFamily: 'Geist, sans-serif',
          borderRadius: '10px',
        },
      }}
    >
      <Authenticated />
    </ClerkProvider>
  )
}
function Authenticated() {
  const { isLoaded, isSignedIn, userId, getToken } = useAuth()
  const api = useMemo(() => new ProjectApi(() => getToken()), [getToken])
  if (!isLoaded)
    return (
      <div className="page-loader">
        <span className="spinner" />
        Opening your workspace
      </div>
    )
  if (!isSignedIn || !userId)
    return (
      <SignInPage>
        <SignIn
          routing="hash"
          appearance={{
            elements: {
              rootBox: { width: '100%' },
              // The unpadded form needs room for control shadows and focus rings.
              cardBox: {
                width: '100%',
                boxShadow: 'none',
                borderRadius: 0,
                overflow: 'visible',
              },
              card: { margin: 0, padding: 0, boxShadow: 'none', background: 'transparent' },
              headerTitle: { fontSize: '18px', textAlign: 'left' },
              headerSubtitle: { display: 'none' },
              footer: { background: 'transparent', paddingLeft: 0, paddingRight: 0 },
            },
          }}
        />
      </SignInPage>
    )
  return <Client key={userId} owner={userId} api={api} userControl={<UserButton />} />
}
function SignInPage({ children }: { children: ReactNode }) {
  return (
    <main className="auth-page">
      <section className="auth-sign-in" aria-labelledby="sign-in-title">
        <span className="brand-mark">
          <Zap size={23} fill="currentColor" />
        </span>
        <h1 id="sign-in-title">
          PowerSystems
          <wbr />
          ModelToJSON
        </h1>
        <p className="auth-description">
          Build an electrical model.
          <br />
          Enter Equipment Ratings.
          <br />
          Define Failover Targets.
          <br />
          Export it as JSON.
        </p>
        <div className="auth-form">{children}</div>
        <p style={{ fontSize: 12, marginTop: 24 }}>
          <a href="/privacy/">Privacy Policy</a> · <a href="/terms/">Terms of Service</a>
        </p>
      </section>
      <SignInPreview />
    </main>
  )
}
function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark">
        <Zap size={23} fill="currentColor" />
      </span>
      <div>
        <strong>
          PowerSystems
          <wbr />
          ModelToJSON
        </strong>
      </div>
    </div>
  )
}
type OpenWorkspace = { editor: Editor; session: ProjectSession; release: () => void }
async function claimProject(owner: string, id: string): Promise<() => void> {
  if (!navigator.locks)
    throw new Error(
      'This browser does not support safe local project locking. Use a current Chrome, Edge, or Safari.',
    )
  return new Promise((resolve, reject) => {
    // Keep the original lock namespace to coordinate safely with already-open tabs.
    void navigator.locks
      .request(`prm:${owner}:${id}`, { ifAvailable: true }, async (lock) => {
        if (!lock) {
          reject(
            new Error(
              'This model is already open in another tab. Close it there before editing here.',
            ),
          )
          return
        }
        await new Promise<void>((release) => resolve(release))
      })
      .catch(reject)
  })
}
function Client({
  owner,
  api,
  userControl,
}: {
  owner: string
  api: ProjectApi | null
  userControl: ReactNode
}) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]),
    [search, setSearch] = useState(''),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [workspace, setWorkspace] = useState<OpenWorkspace | null>(null),
    [creating, setCreating] = useState(false),
    [deleteTarget, setDeleteTarget] = useState<ProjectSummary | null>(null),
    [menu, setMenu] = useState<string | null>(null)
  const file = useRef<HTMLInputElement>(null),
    opened = useRef<OpenWorkspace | null>(null)
  async function list() {
    setLoading(true)
    try {
      const local = await localProjects(owner)
      if (api) {
        try {
          const cloud = await api.list()
          const merged = new Map(local.map((p) => [p.id, p]))
          for (const p of cloud) {
            const cached = await loadLocal(owner, p.id)
            merged.set(
              p.id,
              cached?.dirty
                ? {
                    ...p,
                    name: cached.document.model_name,
                    equipment_count: cached.document.equipment.length,
                  }
                : p,
            )
          }
          setProjects([...merged.values()].sort((a, b) => b.updated_at.localeCompare(a.updated_at)))
        } catch (err) {
          setProjects(local)
          setError(errorMessage(err))
        }
      } else setProjects(local)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    void list()
    return () => {
      const active = opened.current
      if (active) void active.session.close().finally(active.release)
    }
  }, [owner])
  async function open(
    id: string,
    initial?: DocumentRecord,
    cloud?: { document: DocumentRecord; revision: number },
  ) {
    setBusy(true)
    setError('')
    let release: (() => void) | undefined, session: ProjectSession | undefined
    try {
      release = await claimProject(owner, id)
      if (api && !cloud && !initial) {
        try {
          cloud = await api.get(id)
        } catch (err) {
          if (err instanceof ApiError && err.status !== 503) throw err
          if (!(await loadLocal(owner, id))) throw err
        }
      }
      let editor: Editor
      session = new ProjectSession(id, owner, api, (nextId, name) => {
        editor.updateHeader({ model_name: name })
        editor.message(
          'A newer cloud version was found. Your changes are safe in this recovered copy.',
        )
        setProjects((items) => items.map((p) => (p.id === id ? { ...p, id: nextId, name } : p)))
      })
      const document = await session.open(cloud, initial)
      editor = new Editor(document)
      session.attach(editor)
      const active = { editor, session, release }
      opened.current = active
      setWorkspace(active)
    } catch (err) {
      release?.()
      session?.worker.dispose()
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  async function create(document: DocumentRecord) {
    setCreating(false)
    setBusy(true)
    const id = uid()
    try {
      let cloud
      if (api) {
        try {
          cloud = await api.create(document, id)
        } catch (err) {
          if (!(err instanceof TypeError) && navigator.onLine) throw err
        }
      }
      await open(id, document, cloud)
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }
  async function back() {
    if (workspace) {
      setBusy(true)
      try {
        await workspace.session.close()
        workspace.release()
        opened.current = null
        setWorkspace(null)
        await list()
      } catch (err) {
        setError(errorMessage(err))
      } finally {
        setBusy(false)
      }
    }
  }
  async function duplicate(project: ProjectSummary) {
    setMenu(null)
    setBusy(true)
    try {
      const local = await loadLocal(owner, project.id)
      const document = local?.dirty
        ? local.document
        : api
          ? (await api.get(project.id)).document
          : local?.document
      if (!document) throw new Error('Project is not available locally')
      await create({ ...document, model_name: `${document.model_name} — copy` })
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }
  async function importFile(value: File) {
    setBusy(true)
    const worker = new ModelWorker()
    try {
      const document = await worker.call<DocumentRecord>('import', await value.text())
      await create(document)
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    } finally {
      worker.dispose()
      if (file.current) file.current.value = ''
    }
  }
  if (workspace)
    return (
      <Workspace
        editor={workspace.editor}
        session={workspace.session}
        onBack={() => void back()}
        userControl={userControl}
        local={!api}
      />
    )
  const filtered = projects.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()))
  return (
    <div className="projects-page">
      <header className="projects-header">
        <Brand />
        <div className="header-right">
          <span className="workspace-label">
            <span className="tiny-dot green" />
            {api ? 'Personal workspace' : 'Local development workspace'}
          </span>
          {userControl}
        </div>
      </header>
      <main className="projects-main">
        <div className="page-intro">
          <div>
            <span className="eyebrow">YOUR WORKSPACE</span>
            <h1>Power, connected.</h1>
            <p>A place for your systems, connections, and what comes next.</p>
          </div>
          <div className="page-actions">
            <button className="button" onClick={() => file.current?.click()} disabled={busy}>
              <Upload size={15} />
              Import JSON
            </button>
            <button className="button primary" onClick={() => setCreating(true)} disabled={busy}>
              <Plus size={17} />
              New model
            </button>
          </div>
        </div>
        <div className="models-heading">
          <div>
            <h2>Your models</h2>
            <span className="count">{projects.length}</span>
          </div>
          <label className="search-box">
            <Search size={16} />
            <input
              aria-label="Search models"
              placeholder="Search models…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <kbd>⌕</kbd>
          </label>
        </div>
        {error && (
          <div className="error-banner" role="alert">
            <span>{error}</span>
            <button aria-label="Dismiss error" onClick={() => setError('')}>
              <X size={15} />
            </button>
          </div>
        )}
        {loading ? (
          <div className="models-loading">
            <span className="spinner" />
            Loading your models
          </div>
        ) : (
          <div className="model-grid">
            {filtered.map((project) => (
              <article className="project-card" key={project.id}>
                <button
                  className="project-open"
                  onClick={() => void open(project.id)}
                  disabled={busy}
                >
                  <div className="project-cover">
                    <MiniDiagram />
                    <span className="cover-label">ONE-LINE MODEL</span>
                    <span className="open-arrow">
                      <ArrowRight size={18} />
                    </span>
                  </div>
                  <div className="project-card-body">
                    <h3>{project.name}</h3>
                    <p>
                      {project.equipment_count} equipment<span>·</span>Edited{' '}
                      {relativeDate(project.updated_at)}
                    </p>
                  </div>
                </button>
                <div className="project-menu">
                  <button
                    className="icon-button"
                    aria-label={`Actions for ${project.name}`}
                    onClick={() => setMenu(menu === project.id ? null : project.id)}
                  >
                    <MoreHorizontal size={19} />
                  </button>
                  {menu === project.id && (
                    <div className="dropdown">
                      <button onClick={() => void duplicate(project)}>
                        <Copy size={14} />
                        Duplicate model
                      </button>
                      <button
                        className="danger"
                        onClick={() => {
                          setMenu(null)
                          setDeleteTarget(project)
                        }}
                      >
                        <Trash2 size={14} />
                        Delete model
                      </button>
                    </div>
                  )}
                </div>
              </article>
            ))}
            <button className="new-model-card" onClick={() => setCreating(true)} disabled={busy}>
              <span className="new-model-icon">
                <Plus size={24} />
              </span>
              <strong>Create a new model</strong>
              <span>Start with a blank canvas</span>
            </button>
          </div>
        )}
        {!loading && !projects.length && (
          <div className="getting-started">
            <div className="example-card">
              <span className="example-icon">
                <FolderOpen size={24} />
              </span>
              <div>
                <span className="eyebrow">A LITTLE INSPIRATION</span>
                <h3>See how it all connects.</h3>
                <p>
                  Explore a sample distribution model with a utility feed, generator, and manual
                  failover.
                </p>
              </div>
              <button
                className="button"
                onClick={() => void create(exampleDocument())}
                disabled={busy}
              >
                Explore example
                <ArrowRight size={15} />
              </button>
            </div>
          </div>
        )}
        <div className="workspace-note">
          <ShieldCheck size={15} />
          <span>Private by default.</span> Share a complete, editable model by exporting its JSON
          file.
        </div>
        {import.meta.env.DEV && (
          <button
            className="text-button benchmark-link"
            onClick={() => void create(benchmarkDocument())}
            disabled={busy}
          >
            Open performance fixture · 2,000 equipment / 2,500 connectors
          </button>
        )}
      </main>
      <footer className="projects-footer">
        <span>Built for the connections that matter.</span>
        <span>
          <FileJson2 size={14} />
          Open model. Portable by design.
        </span>
      </footer>
      <input
        ref={file}
        type="file"
        accept=".json,application/json"
        className="sr-only"
        onChange={(e) => {
          const value = e.target.files?.[0]
          if (value) void importFile(value)
        }}
      />
      {busy && (
        <div className="busy-indicator" role="status">
          <span className="spinner" />
          Opening model…
        </div>
      )}
      {creating && (
        <NewModel
          onClose={() => setCreating(false)}
          onCreate={(name) => void create(emptyDocument(name))}
        />
      )}
      {deleteTarget && (
        <div className="modal-backdrop">
          <div className="modal" role="dialog" aria-modal="true" aria-label="Delete model">
            <h2>Delete “{deleteTarget.name}”?</h2>
            <p>This removes the model from your workspace and this device.</p>
            <div className="modal-actions">
              <button className="button" onClick={() => setDeleteTarget(null)}>
                Cancel
              </button>
              <button
                className="button destructive"
                onClick={async () => {
                  try {
                    if (api) await api.remove(deleteTarget.id)
                    await removeLocal(owner, deleteTarget.id)
                    setDeleteTarget(null)
                    await list()
                  } catch (err) {
                    setError(errorMessage(err))
                    setDeleteTarget(null)
                  }
                }}
              >
                Delete model
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
function NewModel({
  onClose,
  onCreate,
}: {
  onClose: () => void
  onCreate: (name: string) => void
}) {
  const [name, setName] = useState('')
  return (
    <div className="modal-backdrop">
      <form
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="New model"
        onSubmit={(e) => {
          e.preventDefault()
          if (name.trim()) onCreate(name.trim())
        }}
      >
        <div className="modal-heading">
          <div>
            <span className="eyebrow">A NEW CONNECTION</span>
            <h2>Create a model</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="Close new model"
          >
            <X size={18} />
          </button>
        </div>
        <p className="muted">Give your system a name. You can change it anytime.</p>
        <label className="field">
          <span>Model name</span>
          <input
            autoFocus
            required
            maxLength={200}
            placeholder="e.g. North campus distribution"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <div className="modal-actions">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button primary" disabled={!name.trim()}>
            Create model
            <ChevronRight size={16} />
          </button>
        </div>
      </form>
    </div>
  )
}
function relativeDate(date: string) {
  const delta = Date.now() - Date.parse(date)
  if (delta < 60000) return 'just now'
  if (delta < 3600000) return `${Math.floor(delta / 60000)}m ago`
  if (delta < 86400000) return `${Math.floor(delta / 3600000)}h ago`
  return new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
function MiniDiagram() {
  return (
    <svg viewBox="0 0 360 180" aria-hidden="true">
      <g fill="none" stroke="#9caab9" strokeWidth="1.4">
        <path d="M100 32v35m0 20v36h160m-80 0v27m80-27v27M260 52v71" />
        <circle cx="100" cy="24" r="12" />
        <rect x="91" y="67" width="18" height="20" />
        <circle cx="260" cy="38" r="14" />
        <path d="m172 150 8 13 8-13zm80 0 8 13 8-13z" />
        <path d="M95 27q5-12 10-1" />
      </g>
      <path d="M83 123h192" stroke="#0088ff" strokeWidth="3" strokeLinecap="round" />
      <g fill="#0088ff">
        <circle cx="100" cy="123" r="3" />
        <circle cx="180" cy="123" r="3" />
        <circle cx="260" cy="123" r="3" />
      </g>
      <text x="260" y="43" textAnchor="middle" fill="#93a2b4" fontSize="13" fontFamily="Geist">
        G
      </text>
    </svg>
  )
}
