import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { hash } from 'blake3-wasm'
import { build } from 'esbuild'
const root = path.resolve('dist/client'),
  output = '.wrangler/connector-deploy'
const manifest = {}
async function visit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) await visit(file)
    else {
      const content = await readFile(file)
      manifest['/' + path.relative(root, file).split(path.sep).join('/')] = {
        hash: hash(content.toString('base64') + path.extname(file).slice(1))
          .toString('hex')
          .slice(0, 32),
        size: content.length,
      }
    }
  }
}
await visit(root)
await writeFile(output + '/manifest.json', JSON.stringify(manifest))
await build({
  entryPoints: ['worker/index.ts'],
  outfile: output + '/worker.js',
  bundle: true,
  minify: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  external: ['cloudflare:*', 'node:*'],
})
console.log(`Prepared ${Object.keys(manifest).length} static assets and Worker bundle.`)
