// Run against the development benchmark server in an isolated browser/project.
// node tests/browser/failover-target-colors.mjs http://127.0.0.1:5174
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
const origin = new URL(process.argv[2] ?? 'http://127.0.0.1:5174')
assert.ok(['localhost', '127.0.0.1'].includes(origin.hostname))
const session = `failover-target-${process.pid}`
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
function color(name, expected, marker = false) {
  const result = evaluate(`(() => {
    const {editor:e,renderer:r}=window.__PSMTJ__;
    r.render();
    const v=r.nodes.get(window.__targetKeys[${JSON.stringify(name)}]);
    const strokes=v.lines.context.instructions.filter(i=>i.action==='stroke');
    return {colors:[...new Set(strokes.map(i=>i.data.style.color))], label:v.label.style.fill,
      marker:!!v.targetMarker?.visible, markerColors:v.targetMarker?.visible?v.targetMarker.context.instructions.filter(i=>i.action==='stroke').map(i=>i.data.style.color):[]};
  })()`)
  assert.deepEqual(result.colors, [expected], name + ' symbol color')
  if ([0xec4899, 0xe88724, 0x7c3aed, 0x0088ff, 0x16a085].includes(expected))
    assert.equal(result.label, expected, name + ' label color')
  assert.equal(result.marker, marker, name + ' target marker')
  if (marker) assert.deepEqual(result.markerColors, [0x7c3aed])
}
function clickWorld(x, y) {
  const p = evaluate(
    `(() => {const {editor:e}=window.__PSMTJ__,r=document.querySelector('.canvas-host').getBoundingClientRect();return [Math.round(r.x+e.viewport.x+${x}*e.viewport.zoom),Math.round(r.y+e.viewport.y+${y}*e.viewport.zoom)]})()`,
  )
  browser('mouse', 'move', ...p.map(String))
  browser('mouse', 'down', 'left')
  browser('mouse', 'up', 'left')
}
function edit(code) {
  evaluate(
    `(() => {const {editor:e}=window.__PSMTJ__,{owner,trigger,target,alternate}=window.__targetKeys??{}; ${code}})()`,
  )
}
try {
  browser('open', new URL('/arrangement.html', origin).href)
  browser('wait', '--fn', '!!window.__PSMTJ__')
  edit(`
    const keys={owner:e.add('indoor_drawout_breaker',{x:-240,y:1200}),trigger:e.add('utility_source',{x:0,y:1200}),target:e.add('generator',{x:240,y:1200}),alternate:e.add('bus',{x:240,y:1400})};
    for(const [name,key] of Object.entries(keys)) e.update(key,{id:{owner:'Main_breaker',trigger:'Utility_source',target:'Backup_generator',alternate:'Alternate_bus'}[name],kv_rating:13.8,amp_rating:1200});
    window.__targetKeys=keys; e.setFailover(keys.owner,[keys.trigger],keys.target); e.inspector=keys.owner;e.select([],false);
  `)
  edit(
    `const host=document.querySelector('.canvas-host');e.setViewport({x:host.clientWidth/2,y:host.clientHeight/2-1200*1.2,zoom:1.2})`,
  )
  color('owner', 0xec4899)
  color('target', 0x172334)
  clickWorld(-240, 1200)
  color('owner', 0xec4899)
  color('trigger', 0xe88724)
  color('target', 0x7c3aed)
  browser('screenshot', '/tmp/failover-target-purple.png')
  clickWorld(-380, 1280)
  color('target', 0x172334)
  color('trigger', 0x172334)
  edit('e.select([owner],false);e.setFailover(owner,[trigger],alternate)')
  color('target', 0x172334)
  color('alternate', 0x7c3aed)
  edit('e.undo()')
  color('target', 0x7c3aed)
  color('alternate', 0xb1bbc7)
  edit('e.redo()')
  color('alternate', 0x7c3aed)
  edit('e.startFailoverPick(owner,"parent");e.pickFailover(target)')
  color('target', 0x7c3aed)
  color('alternate', 0xb1bbc7)
  console.log(
    'PASS: purple target symbols and labels, selection/deselection, target changes, undo/redo and immediate target picking',
  )
  edit('e.setFailover(target,[trigger],alternate)')
  color('target', 0xec4899, true)
  color('owner', 0xec4899)
  color('trigger', 0xe88724)
  edit('e.preview={kind:"move",keys:new Set([target]),dx:40,dy:20,duplicate:false}')
  color('target', 0xec4899, true)
  edit('e.preview=null;e.setFailover(owner,[trigger,alternate],alternate)')
  color('alternate', 0xe88724, true)
  edit('e.select([owner,alternate],false)')
  color('alternate', 0x0088ff, true)
  edit('e.select([owner,target],false);e.setFailover(owner,[trigger],target)')
  color('target', 0xec4899, true)
  color('alternate', 0x7c3aed)
  edit('e.select([],false)')
  color('target', 0xec4899)
  color('alternate', 0xb1bbc7)
  assert.deepEqual(browser('errors').errors, [])
  console.log(
    'PASS: distinct purple target markers for overlapping owner/trigger/selection roles, multi-selection and dragging',
  )
} finally {
  browser('close')
}
