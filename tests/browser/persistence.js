;(async () => {
  const { ProjectSession, Editor, emptyDocument, uid, ApiError, loadLocal, removeLocal, database } =
    window.__PSMTJ_TEST__
  const results = []
  const assert = (value, message) => {
    if (!value) throw new Error(message)
  }
  const owner = 'browser-test-' + uid(),
    ids = []
  let session
  try {
    const initial = emptyDocument('Save recovery test'),
      id = uid()
    ids.push(id)
    let fail = false,
      conflict = false,
      requests = [],
      release
    const api = {
      create: async (document, id) => ({ id, document, revision: 0 }),
      request: async (path, init) => {
        const body = JSON.parse(init.body)
        requests.push(body)
        if (conflict) throw new ApiError('Conflict', 409)
        if (fail) throw new TypeError('Offline')
        if (release === undefined) await new Promise((resolve) => (release = resolve))
        return { revision: body.expected_revision + 1 }
      },
    }
    session = new ProjectSession(id, owner, api, () => {})
    const e = new Editor(await session.open({ document: initial, revision: 0 }))
    session.attach(e)
    const key = e.add('utility_source', { x: 50, y: 60 })
    await session.worker.call('flush')
    const syncing = session.sync()
    await new Promise((resolve) => setTimeout(resolve, 40))
    assert(session.sync() === syncing, 'More than one request in flight')
    e.update(key, { id: 'renamed_during_save', kv_rating: 13.8 })
    release()
    await syncing
    let local = await loadLocal(owner, id)
    assert(
      local.dirty && local.document.equipment[0].id === 'renamed_during_save',
      'Edits during save were lost',
    )
    await session.sync()
    local = await loadLocal(owner, id)
    assert(!local.dirty && local.revision === 2, 'Follow-up changes were not saved')
    results.push('single flight and edits during save')
    fail = true
    e.move(new Set([key]), 20, 30, false)
    await session.sync()
    local = await loadLocal(owner, id)
    assert(local.dirty && local.pending, 'Offline changes not durably queued')
    const mutation = local.pending.mutation_id
    await session.close()
    session = new ProjectSession(id, owner, api, () => {})
    const restored = await session.open({ document: initial, revision: 0 })
    assert(restored.equipment[0].x === 70, 'Reload discarded offline changes')
    fail = false
    await session.sync()
    assert(requests.at(-1).mutation_id === mutation, 'Retry lost its mutation ID')
    results.push('offline reload and idempotent retry')
    await session.close()
    const e2 = new Editor(restored)
    let recovered
    session = new ProjectSession(id, owner, api, (next, name) => {
      recovered = { id: next, name }
    })
    await session.open()
    session.attach(e2)
    e2.update(key, { amp_rating: 1200 })
    conflict = true
    await session.sync()
    assert(recovered && recovered.id !== id, 'Conflict did not create recovery project')
    ids.push(recovered.id)
    local = await loadLocal(owner, recovered.id)
    assert(
      local.document.equipment[0].amp_rating === 1200 && local.needsCreate,
      'Recovery lost the latest edits',
    )
    assert(!(await loadLocal(owner, id)), 'Original dirty cache was not transferred')
    conflict = false
    await session.sync()
    results.push('conflict produces separate recovery project')
    const originalWorkerCall = session.worker.call.bind(session.worker)
    session.worker.call = (type, payload) =>
      type === 'patch'
        ? Promise.reject(new Error('Quota exceeded'))
        : originalWorkerCall(type, payload)
    e2.update(key, { amp_rating: 1300 })
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert(
      session.status === 'error' && session.error.includes('Quota'),
      'Storage failure was hidden',
    )
    session.worker.call = originalWorkerCall
    results.push('storage failure is actionable')
    await session.close()
    return { passed: results }
  } finally {
    if (session) await session.close().catch(() => {})
    for (const id of ids) await removeLocal(owner, id)
  }
})()
