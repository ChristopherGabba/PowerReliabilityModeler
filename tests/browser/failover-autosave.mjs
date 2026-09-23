// Run with the development benchmark server; each run uses an isolated local project.
// node tests/browser/failover-autosave.mjs http://127.0.0.1:5174
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const origin = new URL(process.argv[2] ?? 'http://127.0.0.1:5174')
assert.ok(['localhost', '127.0.0.1'].includes(origin.hostname))
const session = `failover-autosave-${process.pid}`
function browser(...args) {
  const result = JSON.parse(
    execFileSync('agent-browser', ['--session', session, '--json', ...args], { encoding: 'utf8' }),
  )
  assert.ok(result.success, result.error)
  return result.data
}
function evaluate(code) {
  const result = JSON.parse(
    execFileSync('agent-browser', ['--session', session, '--json', 'eval', '--stdin'], {
      input: code,
      encoding: 'utf8',
    }),
  )
  assert.ok(result.success, result.error)
  return result.data.result
}
const wait = (condition) => browser('wait', '--fn', condition)
const mouse = (action, ...args) => browser('mouse', action, ...args.map(String))
const triggerButton = '.inspector button.full[aria-pressed]'
const state = () =>
  evaluate(`(() => {
  const e=window.__PSMTJ__.editor, f=e.failovers.find(f=>f.equipment_key===window.__failoverKeys.owner);
  return {triggers:f.trigger_keys.map(k=>e.equipment.get(k).id).sort(),target:e.equipment.get(f.parent_key).id,
    picking:e.failoverPick?.kind??null,highlighted:[...(e.failoverPick?.keys??[])].map(k=>e.equipment.get(k).id).sort(),inspector:e.equipment.get(e.inspector)?.id??null};
})()`)
function screen(point) {
  return evaluate(
    `(() => {const {editor:e}=window.__PSMTJ__, r=document.querySelector('.canvas-host').getBoundingClientRect(), p=${JSON.stringify(point)};return {x:Math.round(r.x+e.viewport.x+p.x*e.viewport.zoom),y:Math.round(r.y+e.viewport.y+p.y*e.viewport.zoom)}})()`,
  )
}
function clickItem(name) {
  const point = evaluate(
    `window.__PSMTJ__.editor.equipment.get(window.__failoverKeys[${JSON.stringify(name)}])`,
  )
  const p = screen(point)
  mouse('move', p.x, p.y)
  mouse('down', 'left')
  mouse('up', 'left')
}
try {
  browser('open', new URL('/arrangement.html', origin).href)
  wait('!!window.__PSMTJ__')
  evaluate(`(() => {
    const {editor:e}=window.__PSMTJ__, keys=window.__ARRANGEMENT_TEST__.keys;
    const owner=keys[0], a=[...e.equipment.values()].find(e=>e.equipment_type==='utility_source').key,b=keys[1], original=keys[2];
    const target=e.add('generator',{x:300,y:-180}); e.update(target,{id:'new_target',kv_rating:13.8,amp_rating:1200});
    for(const [key,id,x,y] of [[owner,'owner',-380,100],[a,'trigger_a',-180,-100],[b,'trigger_b',120,-100],[original,'original_target',360,100]]) {
      const item=e.equipment.get(key); e.move(new Set([key]),x-item.x,y-item.y,false); e.update(key,{id});
    }
    e.setFailover(owner,[],original); e.select([a,b],false);e.group();e.inspector=owner;e.select([owner],false);
    window.__failoverKeys={owner,a,b,target};
  })()`)
  evaluate('window.__PSMTJ__.controller.fit()')
  browser('click', triggerButton)
  assert.equal(evaluate("document.querySelector('.failover-banner')===null"), true)
  assert.equal(state().picking, 'triggers')
  browser('press', 'Escape')
  assert.equal(state().picking, null)
  browser('click', triggerButton)
  clickItem('a')
  assert.deepEqual(state().triggers, ['trigger_a'])
  assert.equal(state().inspector, 'owner')
  assert.equal(evaluate("document.querySelectorAll('.trigger-list .trigger').length"), 1)
  const firstExport = evaluate('(async()=>JSON.parse(await window.__PSMTJ__.session.export()))()')
  assert.deepEqual(firstExport.failovers[0].failover_trigger_ids, ['trigger_a'])
  clickItem('b')
  assert.deepEqual(state().triggers, ['trigger_a', 'trigger_b'])
  browser('click', '[aria-label="Remove trigger trigger_a"]')
  assert.deepEqual(state().highlighted, ['trigger_b'])
  clickItem('a')
  assert.deepEqual(state().triggers, ['trigger_a', 'trigger_b'])
  browser('press', 'Control+z')
  assert.deepEqual(state().highlighted, ['trigger_b'])
  browser('press', 'Control+Shift+z')
  assert.deepEqual(state().highlighted, ['trigger_a', 'trigger_b'])
  clickItem('a')
  const before = evaluate('window.__PSMTJ__.editor.revision')
  const start = screen({ x: -220, y: -170 }),
    end = screen({ x: 180, y: -30 })
  mouse('move', start.x, start.y)
  mouse('down', 'left')
  mouse('move', end.x, end.y)
  mouse('up', 'left')
  assert.deepEqual(state().triggers, ['trigger_a', 'trigger_b'])
  assert.equal(evaluate('window.__PSMTJ__.editor.revision'), before + 1)
  browser('screenshot', '/tmp/failover-autosave-verified.png')
  browser('click', triggerButton)
  assert.equal(state().picking, null)
  assert.deepEqual(state().triggers, ['trigger_a', 'trigger_b'])
  console.log(
    'PASS: immediate click and box saves, sidebar updates/removal, live highlights, undo/redo and no banner',
  )
  browser('click', '[aria-label="Pick Failover Target on canvas"]')
  clickItem('target')
  assert.equal(state().picking, null)
  assert.equal(state().target, 'new_target')
  assert.equal(state().inspector, 'owner')
  const localPath =
    '/@fs' + fileURLToPath(new URL('../../src/persistence/local.ts', import.meta.url))
  const saved = evaluate(`(async()=>{
    const {editor:e,session:s}=window.__PSMTJ__;
    const exported=JSON.parse(await s.export());
    const {loadLocal}=await import(${JSON.stringify(localPath)});
    const record=await loadLocal(s.owner,s.id), reopened=new e.constructor(record.document);
    if(JSON.stringify(reopened.failovers)!==JSON.stringify(e.failovers))throw new Error('Failovers were not saved');
    return exported.failovers[0];
  })()`)
  assert.deepEqual([...saved.failover_trigger_ids].sort(), ['trigger_a', 'trigger_b'])
  assert.equal(saved.failover_parent, 'new_target')
  browser('click', triggerButton)
  browser('click', '[aria-label="Close inspector"]')
  assert.equal(evaluate('window.__PSMTJ__.editor.failoverPick'), null)
  assert.deepEqual(state().triggers, ['trigger_a', 'trigger_b'])
  assert.deepEqual(browser('errors').errors, [])
  console.log(
    'PASS: immediate target save, IndexedDB persistence, export, Escape and inspector-close exit without reverting choices',
  )
} finally {
  browser('close')
}
