// IDs are stable across renames and are scoped to the signed-in owner by the API.
const modelRoute = /^\/models\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i

export function modelIdFromPath(pathname: string): string | null | undefined {
  if (pathname === '/') return null
  return modelRoute.exec(pathname)?.[1].toLowerCase()
}

export function modelPath(id: string | null): string {
  return id === null ? '/' : `/models/${id}`
}

export function updateModelLocation(id: string | null, replace = false) {
  const url = new URL(window.location.href)
  url.pathname = modelPath(id)
  url.hash = ''
  if (url.href === window.location.href) return
  window.history[replace ? 'replaceState' : 'pushState'](window.history.state, '', url)
}
