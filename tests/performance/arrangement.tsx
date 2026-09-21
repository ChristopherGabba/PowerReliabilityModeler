import { createRoot } from 'react-dom/client'
import { Workspace } from '../../src/ui/Workspace'
import { Editor } from '../../src/core/editor'
import { equipmentBounds, endpointPosition } from '../../src/core/geometry'
import { exportModel, importModel } from '../../src/core/schema'
import { ProjectSession } from '../../src/persistence/session'
import { uid } from '../../src/core/types'
import { removeLocal } from '../../src/persistence/local'
import '@fontsource/geist/400.css'
import '@fontsource/geist/500.css'
import '@fontsource/geist/600.css'
import '../../src/styles.css'

async function start() {
  const e = new Editor()
  const source = e.add('utility_source', { x: -440, y: -230 })
  const keys = [
    e.add('oil_filled_transformer', { x: -340, y: 0 }),
    e.add('ring_main_unit', { x: -40, y: 220 }),
    e.add('bus', { x: 390, y: 120 }),
  ]
  e.updateHeader({ model_name: 'Arrangement controls validation' })
  e.connect(
    { equipment_key: source, port_id: 'terminal' },
    { equipment_key: keys[0], port_id: 'primary' },
  )
  for (const key of keys)
    e.update(key, { kv_rating: 13.8, amp_rating: 1200, derating_multiplier: 0.99 })
  e.select(keys)
  e.setViewport({ x: innerWidth / 2, y: innerHeight / 2 - 120, zoom: 0.85 })
  const session = new ProjectSession(uid(), 'arrangement-validation', null, () => {})
  await session.open(undefined, e.snapshot())
  session.attach(e)
  ;(window as any).__ARRANGEMENT_TEST__ = {
    editor: e,
    session,
    keys,
    equipmentBounds,
    endpointPosition,
    exportModel,
    importModel,
    cleanup: async () => {
      await session.close()
      await removeLocal(session.owner, session.id)
    },
  }
  createRoot(document.getElementById('root')!).render(
    <Workspace editor={e} session={session} local userControl={null} onBack={() => {}} />,
  )
}
void start()
