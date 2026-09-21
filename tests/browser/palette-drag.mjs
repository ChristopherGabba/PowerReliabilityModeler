// Run against the real Workspace in the arrangement harness:
// node tests/browser/palette-drag.mjs http://127.0.0.1:5184/arrangement.html
import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'

const session = 'palette-regression'
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
const mouse = (action, ...args) =>
  browser(
    'mouse',
    action,
    ...args.map((value) => String(typeof value === 'number' ? Math.round(value) : value)),
  )
function startDrag(name = 'Utility source') {
  const from = evaluate(`(() => {
    const b = document.querySelector('[aria-label="Place ${name}"]').getBoundingClientRect();
    return {x: b.x + b.width / 2, y: b.y + b.height / 2};
  })()`)
  mouse('move', from.x, from.y)
  mouse('down', 'left')
  mouse('move', from.x, from.y - 12)
}
browser('open', process.argv[2] ?? 'http://127.0.0.1:5184/arrangement.html')
browser('wait', '--fn', '!!window.__PSMTJ__')
evaluate(`(() => {
  const {editor:e} = window.__PSMTJ__;
  e.select([], false); e.setTool('select');
  e.setViewport({x:137, y:91, zoom:1.7});
  window.__paletteBefore = e.equipment.size;
})()`)
const target = evaluate(`(() => {
  const r = document.querySelector('.canvas-host').getBoundingClientRect();
  return {x:Math.round(r.x + r.width * 0.55), y:Math.round(r.y + 180)};
})()`)
startDrag()
mouse('move', target.x, target.y)
mouse('up', 'left')
evaluate(`(() => {
  const {editor:e,controller:c} = window.__PSMTJ__;
  if (e.equipment.size !== window.__paletteBefore + 1)
    throw new Error('Palette drag did not place exactly one device');
  const item = e.equipment.get([...e.selection][0]);
  const point = c.world({clientX:${target.x},clientY:${target.y}});
  if (item.equipment_type !== 'utility_source' || Math.hypot(item.x-point.x,item.y-point.y)>0.001)
    throw new Error('Drop did not respect the panned/zoomed canvas coordinates');
  if (e.tool !== 'select' || e.preview) throw new Error('Drag left placement armed');
  e.undo();
  if (e.equipment.size !== window.__paletteBefore) throw new Error('Drop is not one undo step');
  e.redo();
  if (e.equipment.size !== window.__paletteBefore + 1) throw new Error('Drop redo failed');
})()`)
console.log('PASS: palette drag, transformed coordinates, single placement, undo/redo')

for (const cancel of ['outside', 'overlay', 'escape', 'blur', 'pointercancel']) {
  startDrag('Generator')
  mouse('move', target.x + 80, target.y)
  if (cancel === 'outside') mouse('move', 100, 20)
  if (cancel === 'overlay') {
    const p = evaluate(`(() => {
      const b = document.querySelector('[aria-label="Place Bus"]').getBoundingClientRect();
      return {x:b.x+b.width/2,y:b.y+b.height/2};
    })()`)
    mouse('move', p.x, p.y)
  }
  if (cancel === 'escape') browser('press', 'Escape')
  if (cancel === 'blur') evaluate("window.dispatchEvent(new Event('blur'))")
  if (cancel === 'pointercancel')
    evaluate(`(() => {
    const button = document.querySelector('[aria-label="Place Generator"]');
    for (let id=1; id<10; id++) if (button.hasPointerCapture(id))
      button.dispatchEvent(new PointerEvent('pointercancel', {pointerId:id, bubbles:true}));
  })()`)
  mouse('up', 'left')
  evaluate(`(() => {
    const e = window.__PSMTJ__.editor;
    if (e.equipment.size !== window.__paletteBefore + 1 || e.preview || e.tool !== 'select')
      throw new Error('Cancelled ${cancel} drag changed the model or left a preview/tool active');
  })()`)
  console.log('PASS: cancelled drag (' + cancel + ')')
}

browser('click', '[aria-label="Place Load"]')
evaluate(`(() => {
  const e = window.__PSMTJ__.editor;
  if (e.tool !== 'place' || e.placement !== 'load') throw new Error('Click-to-place no longer works');
})()`)
mouse('move', target.x + 180, target.y)
mouse('down', 'left')
mouse('up', 'left')
evaluate(`(() => {
  const e = window.__PSMTJ__.editor;
  if (e.equipment.size !== window.__paletteBefore + 2 || e.tool !== 'select')
    throw new Error('Click placement did not create exactly one device');
})()`)
console.log('PASS: existing click-to-place')

startDrag('Bus')
mouse('move', target.x, target.y + 100)
// The CLI's low-level mouse command currently omits held-key modifiers. Keep
// the real captured gesture, but supply Shift on its release event explicitly.
evaluate(`(() => {
  const button = document.querySelector('[aria-label="Place Bus"]');
  for (let id=1; id<10; id++) if (button.hasPointerCapture(id))
    button.dispatchEvent(new PointerEvent('pointerup', {
      pointerId:id, bubbles:true, shiftKey:true, clientX:${target.x}, clientY:${target.y + 100}
    }));
})()`)
mouse('up', 'left')
evaluate(`(() => {
  const e = window.__PSMTJ__.editor;
  if (e.equipment.size !== window.__paletteBefore + 3 || e.tool !== 'place' || e.placement !== 'bus')
    throw new Error('Shift-drop did not keep the correct placement tool armed');
  e.setTool('select');
})()`)
console.log('PASS: Shift-drop keeps placing')

const palette = evaluate(`Array.from(document.querySelectorAll('.palette-item'), button => ({
  name: button.getAttribute('aria-label').replace('Place ', ''),
  type: button.querySelector('img').src.split('/').at(-1).replace('.png', '')
}))`)
for (const { name, type } of palette) {
  const before = evaluate('window.__PSMTJ__.editor.equipment.size')
  startDrag(name)
  mouse('move', target.x - 160, target.y)
  evaluate(`(() => {
    const e = window.__PSMTJ__.editor;
    if (e.preview?.kind !== 'place' || e.preview.type !== '${type}' || !e.preview.point)
      throw new Error('Missing ${type} drag preview');
  })()`)
  mouse('up', 'left')
  evaluate(`(() => {
    const e = window.__PSMTJ__.editor;
    if (e.equipment.size !== ${before + 1} ||
        e.equipment.get([...e.selection][0]).equipment_type !== '${type}')
      throw new Error('Incorrect ${type} palette drop');
    e.undo();
  })()`)
}
console.log('PASS: preview and drop for all ' + palette.length + ' palette icons')

// A suppressed post-drag click must not swallow a later keyboard activation.
browser('focus', '[aria-label="Place Generator"]')
browser('press', 'Enter')
evaluate(`(() => {
  const e = window.__PSMTJ__.editor;
  if (e.tool !== 'place' || e.placement !== 'generator')
    throw new Error('Keyboard palette activation was suppressed after a drag');
  e.setTool('select');
})()`)
console.log('PASS: keyboard palette activation after dragging')

// Sample actual WebGL pixels along the stem, above and below the old overlapping lead.
evaluate(`(() => {
  const {editor:e,renderer:r} = window.__PSMTJ__;
  const item = [...e.equipment.values()].find(v=>v.equipment_type==='utility_source');
  e.select([item.key],false);
  e.setViewport({x:500-item.x*7,y:210-item.y*7,zoom:7});
  r.render();
  const gl=r.app.canvas.getContext('webgl2');
  const scale=r.app.canvas.width/document.querySelector('.canvas-host').clientWidth;
  const rows=[20,28,32].map(y=>{
    const width=Math.round(40*scale), pixels=new Uint8Array(width*4);
    gl.readPixels(Math.round(480*scale),r.app.canvas.height-1-Math.round((210+y*7)*scale),
      width,1,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
    const ink=[];
    for(let i=0;i<width;i++) if(pixels[i*4+2]>100&&pixels[i*4+3]>100) ink.push(i);
    return {left:ink[0],right:ink.at(-1),width:ink.length};
  });
  if (!rows[0].width || rows.some(row=>row.left!==rows[0].left || row.right!==rows[0].right))
    throw new Error('Utility stem changes thickness/alignment: '+JSON.stringify(rows));
})()`)
console.log('PASS: utility stem has one consistent width and centerline')
await evaluate('window.__ARRANGEMENT_TEST__.cleanup().then(()=>true)')
