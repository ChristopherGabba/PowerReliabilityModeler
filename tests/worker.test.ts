import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Miniflare, convertV4MiniflareOptions } from 'miniflare'
import { build } from 'esbuild'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { emptyDocument, uid } from '../src/core/types'
import { Editor } from '../src/core/editor'
import { diffDocuments, patchSchema } from '../src/core/schema'

let runtime: Miniflare
const origin = 'https://modeler.test'
const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
})
function token(owner = 'user_a', party = origin, expiry = 300) {
  const now = Math.floor(Date.now() / 1000)
  const encode = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url')
  const body =
    encode({ alg: 'RS256', typ: 'JWT', kid: 'test' }) +
    '.' +
    encode({
      sub: owner,
      sid: 'sess_test',
      iss: 'https://prm-test.clerk.accounts.dev',
      azp: party,
      iat: now,
      nbf: now - 10,
      exp: now + expiry,
      v: 2,
    })
  return (
    body +
    '.' +
    Buffer.from(sign('RSA-SHA256', Buffer.from(body), privateKey)).toString('base64url')
  )
}
async function request(
  path: string,
  owner = 'user_a',
  method = 'GET',
  body?: unknown,
  bearer = token(owner),
) {
  return runtime.dispatchFetch(origin + '/api' + path, {
    method,
    headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
}
beforeAll(async () => {
  const bundle = await build({
    entryPoints: ['worker/index.ts'],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    external: ['cloudflare:*', 'node:*'],
  })
  runtime = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: bundle.outputFiles[0].text,
      compatibilityDate: '2026-09-21',
      compatibilityFlags: ['nodejs_compat'],
      d1Databases: ['DB'],
      durableObjects: { PROJECTS: { className: 'ProjectStore', useSQLite: true } },
      bindings: {
        CLERK_SECRET_KEY: 'sk_test_prm_test_only',
        CLERK_PUBLISHABLE_KEY:
          'pk_test_' + Buffer.from('prm-test.clerk.accounts.dev$').toString('base64'),
        CLERK_JWT_KEY: publicKey,
        CLERK_AUTHORIZED_PARTIES: origin,
      },
      serviceBindings: { ASSETS: () => new Response('static') },
    }),
  )
  const db = await runtime.getD1Database('DB')
  for (const file of ['0001_projects.sql', '0002_project_revision.sql'])
    await db.exec((await readFile('migrations/' + file, 'utf8')).replace(/\n/g, ' '))
}, 30000)
afterAll(async () => {
  await runtime?.dispose()
})
describe('Authenticated Cloudflare storage', () => {
  it('reads legacy outdoor rows and retries a pre-rename mutation without a false conflict', async () => {
    const id = uid(),
      before = emptyDocument('Legacy model'),
      e = new Editor(before)
    const key = e.add('outdoor_breaker', { x: 0, y: 0 })
    e.update(key, { id: 'outdoor_mv_breaker_1', amp_rating: 1200 })
    const after = e.snapshot()
    const patch = JSON.parse(
      JSON.stringify(patchSchema.parse(diffDocuments(before, after))).replaceAll(
        '"equipment_type":"outdoor_breaker"',
        '"equipment_type":"outdoor_mv_breaker"',
      ),
    )
    await request('/projects', 'user_a', 'POST', { id, document: before })
    const mutation_id = uid(),
      expected_revision = 0
    const fingerprint = createHash('sha256')
      .update(JSON.stringify({ expected_revision, patch }))
      .digest('hex')
    // Seed the same raw row and fingerprint the previous server version persisted.
    const namespace = await runtime.getDurableObjectNamespace('PROJECTS')
    const store = namespace.get(namespace.idFromName(id)) as any
    expect(
      (await store.change('user_a', expected_revision, mutation_id, fingerprint, patch)).revision,
    ).toBe(1)
    const offsets = { [key]: { x: 80, y: -20, anchor: 'right' } }
    await request(`/projects/${id}/view`, 'user_a', 'POST', { label_offsets: offsets })
    const saved = (await (await request(`/projects/${id}`)).json()) as any
    expect(saved.document).toEqual(after)
    expect(saved.label_offsets).toEqual(offsets)
    const path = `/projects/${id}/changes`
    const change = { mutation_id, expected_revision, patch }
    expect(await (await request(path, 'user_a', 'POST', change)).json()).toEqual({ revision: 1 })
    patch.equipment.put[0].amp_rating = 2000
    expect((await request(path, 'user_a', 'POST', change)).status).toBe(409)
    e.add('disconnect_switch', { x: 200, y: 0 })
    const next = {
      mutation_id: uid(),
      expected_revision: 1,
      patch: diffDocuments(after, e.snapshot()),
    }
    expect(await (await request(path, 'user_a', 'POST', next)).json()).toEqual({ revision: 2 })
    expect(((await (await request(`/projects/${id}`)).json()) as any).document).toEqual(
      e.snapshot(),
    )
  })
  it('rejects missing, expired, invalid-signature, and wrong-origin sessions', async () => {
    expect((await runtime.dispatchFetch(origin + '/api/projects')).status).toBe(401)
    expect(
      (await request('/projects', 'user_a', 'GET', undefined, token('user_a', origin, -20))).status,
    ).toBe(401)
    expect(
      (
        await request(
          '/projects',
          'user_a',
          'GET',
          undefined,
          token('user_a', 'https://other.test'),
        )
      ).status,
    ).toBe(401)
    expect(
      (await request('/projects', 'user_a', 'GET', undefined, 'bad.signature.token')).status,
    ).toBe(401)
  })
  it('isolates projects across accounts on list, read, mutate, recreate, and delete', async () => {
    const id = uid(),
      document = emptyDocument('Private model')
    const created = await request('/projects', 'user_a', 'POST', { id, document })
    expect(created.status, await created.clone().text()).toBe(201)
    expect((await request('/projects', 'user_b')).status).toBe(200)
    expect(await (await request('/projects', 'user_b')).json()).toEqual([])
    for (const method of ['GET', 'DELETE'])
      expect((await request('/projects/' + id, 'user_b', method)).status).toBe(404)
    expect((await request('/projects/' + id + '/changes', 'user_b', 'POST', {})).status).toBe(404)
    expect((await request('/projects', 'user_b', 'POST', { id, document })).status).toBe(409)
    expect((await request('/projects/' + id)).status).toBe(200)
  })
  it('stores private label offsets separately from JSON and revisions, with owner isolation and atomic validation', async () => {
    const id = uid(),
      e = new Editor()
    const key = e.add('hv_breaker', { x: 0, y: 0 }),
      document = e.snapshot()
    await request('/projects', 'user_a', 'POST', { id, document })
    const path = `/projects/${id}/view`
    const layout = { label_offsets: { [key]: { x: 300, y: -90 } } }
    expect((await request(path, 'user_b', 'POST', layout)).status).toBe(404)
    expect((await request(path, 'user_a', 'POST', layout)).status).toBe(200)
    expect((await request(path, 'user_a', 'POST', layout)).status).toBe(200)
    const result = (await (await request(`/projects/${id}`)).json()) as any
    expect(result.document).toEqual(document)
    expect(result.revision).toBe(0)
    expect(result.label_offsets).toEqual(layout.label_offsets)
    expect(
      (
        await request(path, 'user_a', 'POST', {
          label_offsets: { [key]: { x: 7, y: 9 }, invalid: { x: 'oops', y: 0 } },
        })
      ).status,
    ).toBe(400)
    expect(((await (await request(`/projects/${id}`)).json()) as any).label_offsets).toEqual(
      layout.label_offsets,
    )
    await request(`/projects/${id}`, 'user_a', 'DELETE')
    expect((await request(path, 'user_a', 'POST', layout)).status).toBe(404)
  })
  it('atomically saves patches, deduplicates retries, rejects stale edits, and preserves the cloud document', async () => {
    const id = uid(),
      before = emptyDocument('Before'),
      e = new Editor(before)
    e.add('ring_main_unit', { x: 30, y: 40 })
    e.updateHeader({ model_name: 'After' })
    const after = e.snapshot()
    await request('/projects', 'user_a', 'POST', { id, document: before })
    const change = { mutation_id: uid(), expected_revision: 0, patch: diffDocuments(before, after) }
    expect(
      await (await request('/projects/' + id + '/changes', 'user_a', 'POST', change)).json(),
    ).toEqual({ revision: 1 })
    expect(
      await (await request('/projects/' + id + '/changes', 'user_a', 'POST', change)).json(),
    ).toEqual({ revision: 1 })
    expect(
      (
        await request('/projects/' + id + '/changes', 'user_a', 'POST', {
          ...change,
          mutation_id: uid(),
        })
      ).status,
    ).toBe(409)
    expect(
      (
        await request('/projects/' + id + '/changes', 'user_a', 'POST', {
          ...change,
          expected_revision: 1,
        })
      ).status,
    ).toBe(409)
    const result = (await (await request('/projects/' + id)).json()) as any
    expect(result.document).toEqual(after)
    expect(result.revision).toBe(1)
    const invalid = {
      mutation_id: uid(),
      expected_revision: 1,
      patch: {
        equipment: { put: [], remove: [after.equipment[0].key] },
        connectors: { put: [], remove: [] },
        groups: [{ id: 'invalid', equipment_keys: ['missing', 'also_missing'] }],
      },
    }
    expect((await request('/projects/' + id + '/changes', 'user_a', 'POST', invalid)).status).toBe(
      400,
    )
    expect(((await (await request('/projects/' + id)).json()) as any).document).toEqual(after)
  })
  it('repairs interrupted creation and never resurrects a deleted project', async () => {
    const id = uid(),
      document = emptyDocument('Recovered creation'),
      db = await runtime.getD1Database('DB')
    await db
      .prepare(
        'INSERT INTO projects(id,owner_id,name,created_at,updated_at,equipment_count) VALUES(?,?,?,?,?,?)',
      )
      .bind(id, 'user_a', 'unfinished', 'now', 'now', 0)
      .run()
    expect((await request('/projects', 'user_a', 'POST', { id, document })).status).toBe(201)
    expect(
      (
        await request('/projects', 'user_a', 'POST', {
          id,
          document: { ...document, model_name: 'Ignored retry' },
        })
      ).status,
    ).toBe(201)
    expect(((await (await request('/projects/' + id)).json()) as any).document.model_name).toBe(
      'Recovered creation',
    )
    expect((await request('/projects/' + id, 'user_a', 'DELETE')).status).toBe(200)
    expect((await request('/projects/' + id)).status).toBe(404)
    expect((await request('/projects', 'user_a', 'POST', { id, document })).status).toBe(409)
  })
})
