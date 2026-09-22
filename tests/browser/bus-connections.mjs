// Run against the development benchmark server. The symbols page has no persistence.
// node tests/browser/bus-connections.mjs http://127.0.0.1:5174 /tmp/bus-preview.png
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const origin = new URL(process.argv[2] ?? 'http://127.0.0.1:5174')
assert.ok(['localhost', '127.0.0.1'].includes(origin.hostname), 'Use a local test server')
const session = `bus-connections-${process.pid}`
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
const mouse = (action, ...args) => browser('mouse', action, ...args.map(String))
const controllerPath = `/@fs${fileURLToPath(new URL('../../src/canvas/controller.ts', import.meta.url))}`

try {
  browser('open', new URL('/symbols.html', origin).href)
  browser('wait', '--fn', '!!window.__SYMBOL_TEST__')
  evaluate(`(async () => {
    const {CanvasController} = await import(${JSON.stringify(controllerPath)});
    const {editor:e,renderer:r} = window.__SYMBOL_TEST__;
    const host = document.getElementById('canvas');
    host.tabIndex = 0;
    window.__busController = new CanvasController(e,host);
    window.__busPaths = new Map();
    const draw = r.drawPath;
    r.drawPath = function(graphics,points,color) {
      window.__busPaths.set(graphics,points);
      return draw.call(this,graphics,points,color);
    };
  })()`)

  for (const rotation of [0, 90, 180, 270]) {
    const fixture = evaluate(`(() => {
      const {editor:e,worldPoint} = window.__SYMBOL_TEST__;
      const bus=e.add('bus',{x:0,y:1000+${rotation}*10});
      for(let angle=0;angle<${rotation};angle+=90) e.rotate();
      const bar=e.equipment.get(bus);
      const from=worldPoint(bar,{x:-50,y:-150});
      const to=worldPoint(bar,{x:40,y:-150});
      const device=e.add('utility_source',from);
      for(let angle=0;angle<${rotation};angle+=90) e.rotate();
      const wire=e.connect({equipment_key:device,port_id:'terminal'},
        {equipment_key:bus,port_id:'bar',tap_offset:-50});
      e.select([],false);
      const host=document.getElementById('canvas').getBoundingClientRect();
      const v={x:host.width/2,y:host.height/2-bar.y*1.7,zoom:1.7};
      e.setViewport(v);
      window.__busFixture={bus,device,wire};
      const screen=p=>({x:Math.round(host.x+v.x+p.x*v.zoom),y:Math.round(host.y+v.y+p.y*v.zoom)});
      return {from:screen(from),to:screen(to)};
    })()`)
    mouse('move', fixture.from.x, fixture.from.y)
    mouse('down', 'left')
    mouse('move', fixture.to.x, fixture.to.y)
    browser('wait', '--fn', "window.__SYMBOL_TEST__.editor.preview?.kind === 'move'")
    const preview = evaluate(`(() => {
      const {editor:e,renderer:r,worldPoint} = window.__SYMBOL_TEST__;
      const {bus,wire}=window.__busFixture;
      r.render();
      const path=window.__busPaths.get(r.edges.get(wire).graphics);
      const tap=worldPoint(e.equipment.get(bus),{x:40,y:0});
      if(path.length!==2 || Math.hypot(path.at(-1).x-tap.x,path.at(-1).y-tap.y)>0.01)
        throw new Error('Live wire did not follow the device along the bus');
      if(e.connectors.get(wire).to.tap_offset!==-50)
        throw new Error('Dragging modified saved state before release');
      return path;
    })()`)
    if (rotation === 0 && process.argv[3]) browser('screenshot', process.argv[3])
    mouse('up', 'left')
    const committed = evaluate(`(() => {
      const {editor:e}=window.__SYMBOL_TEST__;
      const {wire}=window.__busFixture;
      const result=e.connectors.get(wire);
      if(Math.abs(result.to.tap_offset-40)>0.01) throw new Error('Tap did not move on release');
      e.undo();
      if(e.connectors.get(wire).to.tap_offset!==-50) throw new Error('Undo did not restore the tap');
      e.redo();
      return e.connectors.get(wire).points;
    })()`)
    assert.deepEqual(committed, preview, 'The wire jumped when the drag ended')
    console.log(`PASS: ${rotation}° bus, live drag, release, undo and redo`)
  }
  browser('errors')
} finally {
  browser('close')
}
