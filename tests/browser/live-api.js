;(async () => {
  const token = await Clerk.session.getToken(),
    headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }
  const request = async (path, method = 'GET', body) =>
    fetch('/api' + path, { method, headers, body: body ? JSON.stringify(body) : undefined })
  const assert = (condition, message) => {
    if (!condition) throw Error(message)
  }
  const id = crypto.randomUUID(),
    document = {
      schema_version: 1,
      model_name: 'Live API validation',
      model_revision: '1',
      model_date: new Date().toISOString().slice(0, 10),
      equipment: [],
      connectors: [],
      failovers: [],
      groups: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    }
  try {
    const created = await request('/projects', 'POST', { id, document })
    assert(created.status === 201, 'Create failed: ' + (await created.clone().text()))
    const mutation = {
      mutation_id: crypto.randomUUID(),
      expected_revision: 0,
      patch: {
        equipment: { put: [], remove: [] },
        connectors: { put: [], remove: [] },
        header: { model_name: 'Saved live', model_revision: '2', model_date: document.model_date },
      },
    }
    for (let i = 0; i < 2; i++) {
      const saved = await request('/projects/' + id + '/changes', 'POST', mutation)
      assert(saved.status === 200, 'Save failed')
      assert((await saved.json()).revision === 1, 'Retry applied twice')
    }
    const stale = await request('/projects/' + id + '/changes', 'POST', {
      ...mutation,
      mutation_id: crypto.randomUUID(),
    })
    assert(stale.status === 409, 'Stale revision accepted')
    const saved = await (await request('/projects/' + id)).json()
    assert(
      saved.document.model_name === 'Saved live' && saved.revision === 1,
      'Cloud model changed unexpectedly',
    )
    assert((await fetch('/api/projects')).status === 401, 'Unauthenticated access allowed')
    return {
      origin: location.origin,
      checked_at: new Date().toISOString(),
      passed: [
        'real Clerk email-code session',
        'atomic patch persistence',
        'idempotent retry',
        'stale revision conflict',
        'unauthenticated API rejection',
      ],
    }
  } finally {
    await request('/projects/' + id, 'DELETE')
  }
})()
