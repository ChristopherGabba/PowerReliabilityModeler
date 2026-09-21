import type { CloudDocument, DocumentRecord, ProjectSummary } from '../core/types'
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
  }
}
export class ProjectApi {
  constructor(private token: () => Promise<string | null>) {}
  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = await this.token()
    if (!token) throw new ApiError('Sign in again to synchronize your changes', 401)
    const response = await fetch(`/api${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...init.headers,
      },
      signal: init.signal ?? AbortSignal.timeout(20000),
    })
    const result = (await response.json()) as T & { error?: string }
    if (!response.ok) throw new ApiError(result.error ?? 'Request failed', response.status)
    return result
  }
  list() {
    return this.request<ProjectSummary[]>('/projects')
  }
  get(id: string) {
    return this.request<CloudDocument>(`/projects/${id}`)
  }
  create(document: DocumentRecord, id?: string) {
    return this.request<CloudDocument & { id: string }>('/projects', {
      method: 'POST',
      body: JSON.stringify({ document, id }),
    })
  }
  remove(id: string) {
    return this.request(`/projects/${id}`, { method: 'DELETE' })
  }
}
