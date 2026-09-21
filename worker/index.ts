import { labelOffsetsSchema } from '../src/core/labels'
import { createClerkClient } from '@clerk/backend'
import { z } from 'zod'
import { errorMessage, patchSchema, validateDocument } from '../src/core/schema'
import { uid } from '../src/core/types'
import { ProjectStore } from './project-store'
export { ProjectStore }
export interface Env extends WorkerBindings {
  CLERK_JWT_KEY?: string
}
const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  })
async function body(request: Request) {
  if (!request.body) throw new Error('Request body is required')
  const reader = request.body.getReader(),
    decoder = new TextDecoder()
  let bytes = 0,
    raw = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > 20_000_000) {
        await reader.cancel()
        throw new Error('Project request exceeds 20 MB')
      }
      raw += decoder.decode(value, { stream: true })
    }
    return JSON.parse(raw + decoder.decode())
  } finally {
    reader.releaseLock()
  }
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request)
    if (url.pathname === '/api/health')
      return json({
        ok: true,
        authenticationConfigured: !!(env.CLERK_SECRET_KEY && env.CLERK_PUBLISHABLE_KEY),
      })
    if (!env.CLERK_SECRET_KEY || !env.CLERK_PUBLISHABLE_KEY)
      return json(
        { error: 'Authentication is not configured yet. Contact the project administrator.' },
        503,
      )
    // Use bearer session tokens only. No cookie-only mutation path or development bypass.
    if (!request.headers.get('Authorization')?.startsWith('Bearer '))
      return json({ error: 'Sign in to continue' }, 401)
    let owner: string
    try {
      const client = createClerkClient({
        secretKey: env.CLERK_SECRET_KEY,
        publishableKey: env.CLERK_PUBLISHABLE_KEY,
      })
      const state = await client.authenticateRequest(request, {
        authorizedParties: (env.CLERK_AUTHORIZED_PARTIES || url.origin)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        acceptsToken: 'session_token',
        jwtKey: env.CLERK_JWT_KEY,
      })
      const userId = state.toAuth()?.userId
      if (!state.isAuthenticated || !userId)
        return json({ error: 'Your session has expired. Please sign in again.' }, 401)
      owner = userId
    } catch {
      return json({ error: 'Your session could not be verified. Please sign in again.' }, 401)
    }
    try {
      if (url.pathname === '/api/projects' && request.method === 'GET') {
        const list = await env.DB.prepare(
          'SELECT id,name,created_at,updated_at,equipment_count FROM projects WHERE owner_id=? AND deleted_at IS NULL ORDER BY updated_at DESC',
        )
          .bind(owner)
          .all()
        return json(list.results)
      }
      if (url.pathname === '/api/projects' && request.method === 'POST') {
        const input = z
          .object({ id: z.string().uuid().optional(), document: z.unknown() })
          .strict()
          .parse(await body(request))
        const document = validateDocument(input.document)
        const id = input.id ?? uid()
        const now = new Date().toISOString()
        await env.DB.prepare(
          'INSERT OR IGNORE INTO projects(id,owner_id,name,created_at,updated_at,equipment_count) VALUES(?,?,?,?,?,?)',
        )
          .bind(id, owner, document.model_name, now, now, document.equipment.length)
          .run()
        const existing = await env.DB.prepare('SELECT owner_id,deleted_at FROM projects WHERE id=?')
          .bind(id)
          .first<{ owner_id: string; deleted_at: string | null }>()
        if (!existing || existing.owner_id !== owner || existing.deleted_at)
          return json({ error: 'Project ID is unavailable' }, 409)
        // Retrying creation also repairs an interrupted D1-to-Durable-Object handoff.
        const result = await env.PROJECTS.getByName(id).initialize(owner, document)
        if ('error' in result) return json(result, result.status)
        await env.DB.prepare(
          'UPDATE projects SET name=?,equipment_count=?,server_revision=? WHERE id=? AND owner_id=? AND server_revision<=?',
        )
          .bind(
            result.document.model_name,
            result.document.equipment.length,
            result.revision,
            id,
            owner,
            result.revision,
          )
          .run()
        return json({ id, ...result }, 201)
      }
      const match = url.pathname.match(/^\/api\/projects\/([a-zA-Z0-9-]+)(?:\/(changes|view))?$/)
      if (!match) return json({ error: 'Not found' }, 404)
      const id = match[1]
      const project = await env.DB.prepare(
        'SELECT id FROM projects WHERE id=? AND owner_id=? AND deleted_at IS NULL',
      )
        .bind(id, owner)
        .first()
      if (!project) return json({ error: 'Project not found' }, 404)
      const store = env.PROJECTS.getByName(id)
      if (!match[2] && request.method === 'GET') {
        const result = await store.getDocument(owner)
        return json(result, 'error' in result ? result.status : 200)
      }
      if (match[2] === 'view' && request.method === 'POST') {
        const input = z
          .object({ label_offsets: labelOffsetsSchema })
          .strict()
          .parse(await body(request))
        const result = await store.updateView(owner, input.label_offsets)
        return json(result, 'error' in result ? result.status : 200)
      }
      if (match[2] === 'changes' && request.method === 'POST') {
        const payload = await body(request)
        const input = z
          .object({
            expected_revision: z.number().int().nonnegative(),
            mutation_id: z.string().uuid(),
            patch: patchSchema,
          })
          .strict()
          .parse(payload)
        // Preserve the validated wire spelling in fingerprints so edits queued before
        // an equipment-type rename can still retry an already-accepted mutation.
        const fingerprintPatch = {
          ...input.patch,
          equipment: {
            ...input.patch.equipment,
            put: input.patch.equipment.put.map((equipment, index) => ({
              ...equipment,
              equipment_type: payload.patch.equipment.put[index].equipment_type,
            })),
          },
        }
        const bytes = new TextEncoder().encode(
          JSON.stringify({ expected_revision: input.expected_revision, patch: fingerprintPatch }),
        )
        const digest = await crypto.subtle.digest('SHA-256', bytes)
        const fingerprint = Array.from(new Uint8Array(digest), (v) =>
          v.toString(16).padStart(2, '0'),
        ).join('')
        const result = await store.change(
          owner,
          input.expected_revision,
          input.mutation_id,
          fingerprint,
          input.patch,
        )
        if ('error' in result) return json(result, result.status)
        if ('name' in result)
          await env.DB.prepare(
            'UPDATE projects SET name=?,equipment_count=?,updated_at=?,server_revision=? WHERE id=? AND owner_id=? AND server_revision<=?',
          )
            .bind(
              result.name,
              result.equipment_count,
              new Date().toISOString(),
              result.current_revision,
              id,
              owner,
              result.current_revision,
            )
            .run()
        return json({ revision: result.revision })
      }
      if (!match[2] && request.method === 'DELETE') {
        await env.DB.prepare('UPDATE projects SET deleted_at=? WHERE id=? AND owner_id=?')
          .bind(new Date().toISOString(), id, owner)
          .run()
        await store.remove(owner)
        return json({ ok: true })
      }
      return json({ error: 'Method not allowed' }, 405)
    } catch (error) {
      if (
        error instanceof z.ZodError ||
        error instanceof SyntaxError ||
        (error instanceof Error && !/D1_|SQLITE|internal/i.test(error.message))
      )
        return json({ error: errorMessage(error) }, 400)
      console.error('Project operation failed')
      return json(
        { error: 'The project could not be saved. Your local changes are retained.' },
        500,
      )
    }
  },
} satisfies ExportedHandler<Env>
