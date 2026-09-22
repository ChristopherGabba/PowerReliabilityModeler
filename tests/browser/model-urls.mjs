// Run against VITE_LOCAL_DEMO=true vite on a dedicated localhost port.
// Creates its own local models; never opens or changes production data.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'

const base = process.argv[2] ?? 'http://127.0.0.1:5186'
assert.match(base, /^http:\/\/(127\.0\.0\.1|localhost):\d+$/)
const session = 'model-url-regression'
function browser(...args) {
  const response = JSON.parse(
    execFileSync('agent-browser', ['--session', session, '--json', ...args], { encoding: 'utf8' }),
  )
  assert.ok(response.success, response.error)
  return response.data
}
function evaluate(code) {
  const response = JSON.parse(
    execFileSync('agent-browser', ['--session', session, '--json', 'eval', '--stdin'], {
      input: code,
      encoding: 'utf8',
    }),
  )
  assert.ok(response.success, response.error)
  return response.data.result
}
const waitForModel = () => browser('wait', '--fn', '!!window.__PSMTJ__')
const name = `Model URL regression ${Date.now()}`
browser('open', base)
browser('wait', '--text', 'Your models')
browser('find', 'role', 'button', 'click', '--name', 'New model', '--exact')
browser('find', 'label', 'Model name', 'fill', name)
browser('find', 'role', 'button', 'click', '--name', 'Create model', '--exact')
waitForModel()
const id = evaluate('window.__PSMTJ__.session.id')
assert.equal(
  evaluate('location.pathname'),
  `/models/${id}`,
  'Opening a model must assign a stable model URL',
)
evaluate(
  `(async () => { const {editor,session}=window.__PSMTJ__; editor.add('utility_source',{x:0,y:0}); await session.worker.call('flush'); return true })()`,
)
browser('reload')
waitForModel()
assert.deepEqual(
  evaluate('({id:window.__PSMTJ__.session.id,equipment:window.__PSMTJ__.editor.equipment.size})'),
  { id, equipment: 1 },
  'Refresh must reopen the same saved model',
)
browser('back')
browser('wait', '--text', 'Your models')
assert.equal(evaluate('location.pathname'), '/')
browser('forward')
waitForModel()
assert.equal(evaluate('window.__PSMTJ__.session.id'), id)
browser('find', 'role', 'button', 'click', '--name', 'Back to models', '--exact')
browser('wait', '--text', 'Your models')
assert.equal(evaluate('location.pathname'), '/')
browser('find', 'text', name, 'click', '--exact')
waitForModel()
assert.equal(evaluate('location.pathname'), `/models/${id}`)
browser('open', `${base}/models/${id}?renderer=webgl`)
waitForModel()
assert.equal(evaluate('window.__PSMTJ__.session.id'), id)
// A failed save must keep the editor, its edits, and its model URL available.
evaluate(`(() => {
  const session=window.__PSMTJ__.session, call=session.worker.call.bind(session.worker);
  window.__restoreWorkerCall=()=>{session.worker.call=call};
  session.worker.call=(type,...args)=>type==='flush'?Promise.reject(new Error('Simulated local save failure')):call(type,...args);
})()`)
browser('find', 'role', 'button', 'click', '--name', 'Back to models', '--exact')
browser('wait', '--text', 'Simulated local save failure')
assert.equal(evaluate('location.pathname'), `/models/${id}`)
assert.equal(evaluate('window.__PSMTJ__.editor.equipment.size'), 1)
evaluate('window.__restoreWorkerCall()')
browser('find', 'role', 'button', 'click', '--name', 'Back to models', '--exact')
browser('wait', '--text', 'Your models')

// Pause a direct-link load at the real project lock, then reverse navigation.
evaluate(`(() => {
  const request=navigator.locks.request.bind(navigator.locks);
  let once=true;
  navigator.locks.request=async (...args)=>{
    if(once && args[0].endsWith('${id}')) {
      once=false;window.__loadPaused=true;
      await new Promise(resolve=>{window.__resumeLoad=resolve});
    }
    return request(...args);
  };
  window.__restoreLocks=()=>{navigator.locks.request=request};
  history.back();
})()`)
browser('wait', '--fn', 'window.__loadPaused===true')
evaluate('history.forward()')
browser('wait', '--fn', 'location.pathname==="/"')
evaluate('window.__resumeLoad();window.__restoreLocks()')
browser('wait', '--fn', '!document.querySelector(".busy-indicator")')
assert.equal(
  evaluate('!!window.__PSMTJ__'),
  false,
  'A canceled model load must not reopen the editor',
)
assert.equal(evaluate('location.pathname'), '/')
browser('find', 'text', name, 'click', '--exact')
waitForModel()
assert.equal(
  evaluate('window.__PSMTJ__.session.id'),
  id,
  'Canceled load must release its project lock',
)

// Renaming retains the model identity and address.
evaluate(
  `(async () => {const {editor,session}=window.__PSMTJ__;editor.updateHeader({model_name:'Renamed URL regression'});await session.worker.call('flush');return true})()`,
)
assert.equal(evaluate('location.pathname'), `/models/${id}`)
browser('reload')
waitForModel()
assert.equal(evaluate('window.__PSMTJ__.editor.snapshot().model_name'), 'Renamed URL regression')
browser('tab', 'new', `${base}/models/${id}`)
browser('wait', '--text', 'already open in another tab')
assert.equal(
  evaluate('!!window.__PSMTJ__'),
  false,
  'Direct links must respect the existing edit lock',
)
browser('tab', 'close')
browser('open', `${base}/models/not-a-model`)
browser('wait', '--text', 'This model URL is not valid.')
assert.equal(evaluate('!!window.__PSMTJ__'), false)

browser('open', `${base}/models/00000000-0000-4000-8000-000000000000`)
browser('wait', '--text', 'not available')
assert.equal(evaluate('!!window.__PSMTJ__'), false)
browser('find', 'role', 'button', 'click', '--name', 'Back to models', '--exact')
browser('wait', '--text', 'Your models')
assert.equal(evaluate('location.pathname'), '/')
console.log(
  JSON.stringify(
    {
      passed: true,
      checks: [
        'stable model URL',
        'refresh with persisted edits',
        'browser Back/Forward',
        'Back to models',
        'reopen from library',
        'direct URL with query',
        'missing model recovery',
        'failed save retains editor and URL',
        'rapid Back/Forward cancels stale model loads',
        'canceled load releases project lock',
        'rename retains model URL',
        'invalid model URL',
        'direct links respect the cross-tab edit lock',
      ],
      modelId: id,
    },
    null,
    2,
  ),
)
browser('close')
