// Run against the development benchmark server; each run uses an isolated browser and project.
// node tests/browser/find-export.mjs http://127.0.0.1:5174
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
const origin = new URL(process.argv[2] ?? 'http://127.0.0.1:5174')
assert.ok(['localhost', '127.0.0.1'].includes(origin.hostname))
const session = `find-export-${process.pid}`
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
const state = () =>
  evaluate(`(() => {
  const e=window.__PSMTJ__.editor, host=document.querySelector('.canvas-host');
  const selected=[...e.selection].map(k=>e.equipment.get(k).id);
  const item=e.equipment.get(e.inspector), v=e.viewport;
  return {selected, inspector:item?.id, centered:!!item && Math.abs(item.x*v.zoom+v.x-host.clientWidth/2)<1 && Math.abs(item.y*v.zoom+v.y-host.clientHeight/2)<1};
})()`)
try {
  browser('open', new URL('/arrangement.html', origin).href)
  wait('!!window.__PSMTJ__')
  evaluate(`(() => {
    const e=window.__PSMTJ__.editor;
    const first=e.add('utility_source',{x:7000,y:5000}), second=e.add('bus',{x:7200,y:5000});
    e.update(first,{id:'EQUIP_FIND_001'}); e.update(second,{id:'EQUIP_FIND_002',kv_rating:13.8});
    e.select([first,second],false); e.group(); e.select([],false);
    window.__findKeys={first,second}; window.__downloads=[];
    const create=URL.createObjectURL.bind(URL);
    URL.createObjectURL=blob=>{ window.__downloads.push(blob.text()); return create(blob) };
    const click=HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click=function(){ if(!this.download) click.call(this) };
    window.__PSMTJ__.controller.focus();
  })()`)
  browser('press', 'Control+f')
  browser('fill', '[aria-label="Find by equipment ID"]', '  equip_find  ')
  assert.equal(evaluate("document.querySelectorAll('.finder-results button').length"), 2)
  browser('press', 'ArrowDown')
  browser('press', 'Enter')
  wait('window.__PSMTJ__.editor.inspector===window.__findKeys.second')
  assert.deepEqual(state(), {
    selected: ['EQUIP_FIND_002'],
    inspector: 'EQUIP_FIND_002',
    centered: true,
  })
  browser('press', 'Meta+f')
  browser('fill', '[aria-label="Find by equipment ID"]', 'EQUIP_FIND_001')
  browser('press', 'Enter')
  wait('window.__PSMTJ__.editor.inspector===window.__findKeys.first')
  assert.deepEqual(state(), {
    selected: ['EQUIP_FIND_001'],
    inspector: 'EQUIP_FIND_001',
    centered: true,
  })
  browser('press', 'Control+f')
  browser('fill', '[aria-label="Find by equipment ID"]', 'NO_MATCH_98765')
  assert.equal(
    evaluate("document.querySelector('.finder-hint').textContent"),
    'No matching equipment.',
  )
  browser('press', 'Enter')
  assert.equal(state().inspector, 'EQUIP_FIND_001')
  browser('press', 'Escape')
  assert.equal(evaluate('document.activeElement.className'), 'canvas-host')
  console.log(
    'PASS: Ctrl/Cmd+F, partial/case-insensitive IDs, arrows, Enter, group member focus, no matches and Escape',
  )

  browser('click', '.export-button')
  wait("!!document.querySelector('[role=alertdialog]')")
  assert.equal(evaluate("document.querySelectorAll('.export-error-list button').length"), 2)
  assert.equal(evaluate('window.__downloads.length'), 0)
  browser('click', '.export-error-list button:nth-child(2)')
  assert.equal(evaluate("!!document.querySelector('[role=alertdialog]')"), true)
  browser('dblclick', '.export-error-list button:nth-child(2)')
  wait("!document.querySelector('[role=alertdialog]')")
  assert.deepEqual(state(), {
    selected: ['EQUIP_FIND_002'],
    inspector: 'EQUIP_FIND_002',
    centered: true,
  })
  const blocked = evaluate(
    `(async()=>{try {await window.__PSMTJ__.session.export();return false}catch(error){return error.message.includes('Missing current')}})()`,
  )
  assert.equal(blocked, true)
  browser('click', '.export-button')
  browser('press', 'Enter')
  wait('window.__PSMTJ__.editor.inspector===window.__findKeys.first')
  assert.equal(state().centered, true)
  console.log(
    'PASS: no incomplete downloads, worker validation, double-click and keyboard error navigation',
  )

  browser('fill', '.inspector .field-grid > label:nth-child(1) input', '13.8')
  browser('fill', '.inspector .field-grid > label:nth-child(2) input', '1200')
  browser('click', '.export-button')
  assert.equal(
    evaluate("document.querySelectorAll('.export-error-list button').length"),
    1,
    JSON.stringify(
      evaluate(
        "({items:[...window.__PSMTJ__.editor.equipment.values()].map(({id,kv_rating,amp_rating})=>({id,kv_rating,amp_rating})),dialog:document.querySelector('[role=alertdialog]')?.textContent,downloads:window.__downloads.length})",
      ),
    ),
  )
  assert.equal(evaluate('window.__downloads.length'), 0)
  browser('dblclick', '.export-error-list button')
  browser('fill', '.inspector .field-grid > label:nth-child(2) input', '1200')
  browser('click', '.export-button')
  wait('window.__downloads.length===1')
  const download = evaluate(`(async()=>JSON.parse(await window.__downloads[0]))()`)
  assert.ok(!('groups' in download))
  assert.ok(download.equipment.every((item) => item.kv_rating !== null && item.amp_rating !== null))
  assert.equal(evaluate('window.__PSMTJ__.editor.groups.length'), 1)
  assert.equal(
    evaluate(
      'window.__ARRANGEMENT_TEST__.importModel(' + JSON.stringify(download) + ').groups.length',
    ),
    0,
  )
  browser('press', 'Control+f')
  browser('fill', '[aria-label="Find by equipment ID"]', 'EQUIP_FIND')
  browser('screenshot', '/tmp/find-equipment-verified.png')
  assert.deepEqual(browser('errors').errors, [])
  console.log(
    'PASS: corrected JSON download, ratings included, groups omitted and retained in saved editor state',
  )
} finally {
  browser('close')
}
