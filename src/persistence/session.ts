import type { LabelOffsets } from '../core/labels'
import type { Editor } from '../core/editor'
import type { DocumentRecord } from '../core/types'
import { ApiError, ProjectApi } from './api'
import { loadLocal, recordKey, type LocalRecord } from './local'

export class ModelWorker {
  private worker = new Worker(new URL('../workers/model.worker.ts', import.meta.url), {
    type: 'module',
  })
  private sequence = 0
  private disposed = false
  private jobs = new Map<
    number,
    { resolve: (value: any) => void; reject: (error: Error) => void }
  >()
  constructor() {
    this.worker.onmessage = (e) => {
      const job = this.jobs.get(e.data.id)
      if (!job) return
      this.jobs.delete(e.data.id)
      if (e.data.error) job.reject(new Error(e.data.error))
      else job.resolve(e.data.result)
    }
    this.worker.onerror = () => {
      for (const job of this.jobs.values())
        job.reject(new Error('The background worker stopped. Your last local save is retained.'))
      this.jobs.clear()
    }
  }
  call<T = unknown>(type: string, payload?: unknown): Promise<T> {
    if (this.disposed)
      return Promise.reject(new Error('Worker is closed. Reopen the project to continue.'))
    const id = ++this.sequence
    return new Promise((resolve, reject) => {
      this.jobs.set(id, { resolve, reject })
      this.worker.postMessage({ id, type, payload })
    })
  }
  dispose() {
    this.disposed = true
    this.worker.terminate()
    for (const job of this.jobs.values()) job.reject(new Error('Worker closed'))
    this.jobs.clear()
  }
}
export type SaveStatus = 'saved' | 'saving' | 'local' | 'offline' | 'error'
export class ProjectSession {
  readonly worker = new ModelWorker()
  private timer: ReturnType<typeof setInterval> | undefined
  private labelOffsets: LabelOffsets = {}
  private unsubscribeLabels: (() => void) | undefined
  private unsubscribe: (() => void) | undefined
  private closed = false
  status: SaveStatus = 'saved'
  error = ''
  private listeners = new Set<() => void>()
  private version = 0
  private active: Promise<void> | null = null
  private localFailed = false
  private localWrites = 0
  private closing: Promise<void> | null = null
  constructor(
    public id: string,
    readonly owner: string,
    private api: ProjectApi | null,
    private onRecovery: (id: string, name: string) => void,
  ) {}
  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }
  getSnapshot = () => this.version
  private report(status: SaveStatus, error = '') {
    this.status = status
    this.error = error
    this.version++
    for (const fn of this.listeners) fn()
  }
  async open(
    cloud?: { document: DocumentRecord; revision: number; label_offsets?: LabelOffsets },
    initial?: DocumentRecord,
  ) {
    const cached = await loadLocal(this.owner, this.id)
    let local: LocalRecord
    if (cached?.dirty || (!cloud && cached)) local = cached
    else {
      const document = cloud?.document ?? initial
      if (!document) throw new Error('This project is not available offline yet')
      local = {
        key: recordKey(this.owner, this.id),
        owner: this.owner,
        id: this.id,
        document,
        base: document,
        revision: cloud?.revision ?? 0,
        dirty: !cloud,
        sequence: 0,
        updated_at: new Date().toISOString(),
        needsCreate: !cloud,
      }
    }
    const cachedView = cached?.view
    const offsets = cloud?.label_offsets
      ? { ...cloud.label_offsets, ...cachedView?.pending, ...cachedView?.dirty }
      : (cachedView?.offsets ?? {})
    local.view = { offsets, dirty: cachedView?.dirty ?? {}, pending: cachedView?.pending }
    this.labelOffsets = offsets
    await this.worker.call('initialize', local)
    this.report(this.api ? (local.dirty ? 'local' : 'saved') : 'local')
    return local.document
  }
  attach(editor: Editor) {
    editor.loadLabelOffsets(this.labelOffsets)
    this.unsubscribeLabels = editor.onLabelChange((offsets) =>
      this.writeLocal('labelPatch', offsets),
    )
    this.unsubscribe = editor.onChange((patch) => this.writeLocal('patch', patch))
    this.timer = setInterval(() => {
      void this.sync()
    }, 2000)
    window.addEventListener('online', this.online)
    window.addEventListener('offline', this.offline)
    window.addEventListener('beforeunload', this.beforeUnload)
  }
  private writeLocal(operation: 'patch' | 'labelPatch', patch: unknown) {
    this.localWrites++
    this.report(this.api ? 'saving' : 'local')
    void this.worker
      .call(operation, patch)
      .then(() => {
        this.localFailed = false
        if (!navigator.onLine && this.api) this.report('offline')
      })
      .catch((error) => {
        this.localFailed = true
        this.report('error', String(error))
      })
      .finally(() => {
        this.localWrites--
      })
  }
  private online = () => {
    void this.sync()
  }
  private offline = () => this.report('offline')
  private beforeUnload = (event: BeforeUnloadEvent) => {
    if (this.localFailed || this.localWrites) {
      event.preventDefault()
      event.returnValue = ''
    }
  }
  sync(): Promise<void> {
    if (this.active) return this.active
    if (this.closed || this.closing) return Promise.resolve()
    this.active = this.synchronize().finally(() => {
      this.active = null
    })
    return this.active
  }
  private async synchronize() {
    try {
      if (!this.api) {
        await this.worker.call('localAck')
        this.localFailed = false
        this.report('local')
        return
      }
      if (!navigator.onLine) {
        this.report('offline')
        return
      }
      const pending = await this.worker.call<any>('prepare')
      this.localFailed = false
      let dirty = false
      if (pending) {
        this.report('saving')
        let result: { revision: number }
        if (pending.create) result = await this.api.create(pending.request.document, pending.id)
        else
          result = await this.api.request(`/projects/${pending.id}/changes`, {
            method: 'POST',
            body: JSON.stringify({
              mutation_id: pending.request.mutation_id,
              expected_revision: pending.request.expected_revision,
              patch: pending.request.patch,
            }),
          })
        dirty = (await this.worker.call<{ dirty: boolean }>('ack', result)).dirty
      }
      // One network request in flight for both the model and its private label layout.
      const view = await this.worker.call<{ id: string; offsets: LabelOffsets } | null>(
        'prepareView',
      )
      if (view) {
        this.report('saving')
        await this.api.request(`/projects/${view.id}/view`, {
          method: 'POST',
          body: JSON.stringify({ label_offsets: view.offsets }),
        })
        const state = await this.worker.call<{ dirty: boolean }>('ackView')
        dirty ||= state.dirty
      }
      this.report(dirty ? 'saving' : 'saved')
    } catch (error) {
      if (error instanceof ApiError && (error.status === 409 || error.status === 404)) {
        const recovery = await this.worker.call<{ id: string; name: string }>('recover')
        this.id = recovery.id
        this.onRecovery(recovery.id, recovery.name)
        this.report('local', 'Changes recovered as a separate project.')
      } else if (error instanceof TypeError || !navigator.onLine) this.report('offline')
      else this.report('error', error instanceof Error ? error.message : String(error))
    }
  }
  async export() {
    return this.worker.call<string>('export')
  }
  dismissError() {
    this.report(this.status)
  }
  close(): Promise<void> {
    if (this.closing) return this.closing
    this.closing = (async () => {
      await this.active?.catch(() => {})
      await this.worker.call('flush')
      this.closed = true
      this.unsubscribe?.()
      this.unsubscribeLabels?.()
      clearInterval(this.timer)
      window.removeEventListener('online', this.online)
      window.removeEventListener('offline', this.offline)
      window.removeEventListener('beforeunload', this.beforeUnload)
      this.worker.dispose()
    })().catch((error) => {
      this.closing = null
      throw error
    })
    return this.closing
  }
}
