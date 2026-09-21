// An authenticated Cloudflare connector creates the short-lived upload session.
// This script only sends this build's public assets using that scoped token.
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
const directory = '.wrangler/connector-deploy',
  session = JSON.parse(await readFile(directory + '/upload-session.json', 'utf8')),
  manifest = JSON.parse(await readFile(directory + '/manifest.json', 'utf8'))
const account = '60ac85e6af5ed5089074bc8a1957f9ac',
  single =
    JSON.parse(Buffer.from(session.jwt.split('.')[1], 'base64url'))
      .wrangler_single_asset_uploads === true
const lookup = new Map(Object.entries(manifest).map(([name, entry]) => [entry.hash, name]))
const types = {
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.html': 'text/html',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
}
let completion = session.buckets.flat().length ? '' : session.jwt
const buckets = single ? session.buckets.flat().map((h) => [h]) : session.buckets
for (const hashes of buckets) {
  let body,
    url = 'https://api.cloudflare.com/client/v4/accounts/' + account + '/workers/assets/upload'
  const headers = { Authorization: 'Bearer ' + session.jwt }
  if (single) {
    const name = lookup.get(hashes[0])
    body = await readFile(path.join('dist/client', name))
    headers['Content-Type'] = types[path.extname(name)] ?? 'application/octet-stream'
    url += '/' + hashes[0]
  } else {
    body = new FormData()
    for (const hash of hashes) {
      const name = lookup.get(hash),
        content = await readFile(path.join('dist/client', name))
      body.append(
        hash,
        new Blob([content.toString('base64')], {
          type: types[path.extname(name)] ?? 'application/octet-stream',
        }),
        hash,
      )
    }
    url += '?base64=true'
  }
  const response = await fetch(url, { method: 'POST', headers, body })
  const result = await response.json()
  if (!response.ok || !result.success)
    throw new Error('Asset upload failed: ' + JSON.stringify(result.errors))
  completion = result.result.jwt ?? completion
}
if (!completion) throw new Error('No completion token returned')
await writeFile(directory + '/completion-token', completion, { mode: 0o600 })
console.log('Preview assets uploaded successfully.')
