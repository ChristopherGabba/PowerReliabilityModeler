;(async () => {
  const { ProjectSession, Editor, uid, loadLocal, removeLocal } = window.__PSMTJ_TEST__
  const assert = (value, message) => {
    if (!value) throw new Error(message)
  }
  const owner = 'label-test-' + uid(),
    id = uid()
  const source = new Editor()
  const key = source.add('indoor_drawout_breaker', { x: 0, y: 0 })
  const document = source.snapshot()
  let session,
    release,
    requestStarted,
    offline = true
  const requests = []
  const api = {
    request: async (path, init) => {
      requests.push({ path, body: JSON.parse(init.body) })
      if (offline) throw new TypeError('Offline')
      requestStarted?.()
      if (release === undefined)
        await new Promise((resolve) => {
          release = resolve
        })
      return { ok: true }
    },
  }
  try {
    session = new ProjectSession(id, owner, api, () => {})
    let e = new Editor(await session.open({ document, revision: 3, label_offsets: {} }))
    session.attach(e)
    e.setLabelOffset(key, { x: 100, y: -20 })
    await session.sync()
    assert(session.status === 'offline', 'Failed view save should remain available offline')
    await session.close()
    session = new ProjectSession(id, owner, api, () => {})
    e = new Editor(
      await session.open({ document, revision: 3, label_offsets: { [key]: { x: 1, y: 2 } } }),
    )
    session.attach(e)
    assert(e.labelOffsets.get(key)?.x === 100, 'Cloud view overwrote unsynced local label')
    assert(
      (await loadLocal('another-user', id)) === undefined,
      'Local labels leaked across accounts',
    )
    offline = false
    const started = new Promise((resolve) => {
      requestStarted = resolve
    })
    const saving = session.sync()
    await started
    assert(saving === session.sync(), 'View sync started a second simultaneous request')
    e.setLabelOffset(key, { x: 200, y: 80 })
    release()
    await saving
    let local = await loadLocal(owner, id)
    assert(local.view.dirty[key]?.x === 200, 'Ack discarded a label edit made during save')
    await session.sync()
    local = await loadLocal(owner, id)
    assert(
      Object.keys(local.view.dirty).length === 0 && !local.view.pending,
      'View retry was not acknowledged',
    )
    assert(local.revision === 3 && !local.dirty, 'Moving a label modified model revision')
    assert(
      requests.every((request) => request.path.endsWith('/view')),
      'Label edit sent electrical model changes',
    )
    assert(
      !JSON.parse(await session.export()).equipment.some((item) => 'label_offsets' in item),
      'Label offsets leaked into JSON',
    )
    await session.close()
    session = new ProjectSession(id, owner, api, () => {})
    e = new Editor(await session.open())
    session.attach(e)
    assert(e.labelOffsets.get(key)?.x === 200, 'Label layout did not survive offline reopening')
    const recovery = await session.worker.call('recover')
    const recovered = await loadLocal(owner, recovery.id)
    assert(
      recovered.view.offsets[key].x === 200 && recovered.view.dirty[key].x === 200,
      'Recovery project lost label layout',
    )
    await removeLocal(owner, recovery.id)
    return {
      passed: [
        'offline view retry',
        'cloud/local merge',
        'account isolation',
        'single request in flight',
        'edits during save',
        'no model revision changes',
        'JSON exclusion',
        'offline reopening',
        'recovery project layout',
      ],
    }
  } finally {
    await session?.close()
    await removeLocal(owner, id)
    // Closing a worker flushes the recovered record; clean that record as well.
    const db = await window.__PSMTJ_TEST__.database()
    for (const local of await db.getAll('documents'))
      if (local.owner === owner) await db.delete('documents', local.key)
  }
})()
