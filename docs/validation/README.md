# Validation guide

Keep reusable tests, fixtures, and instructions in the repository. Save screenshots, raw JSON reports, browser recordings, and deployment captures to an OS temporary directory, such as one created with `mktemp -d`. Do not commit one-off validation output. Standard generated test-report and coverage directories are also ignored.

## Automated checks

```sh
bun run test
bun run build
```

The suite covers graph editing, catalog geometry, labels, arrangement, inspectors, model import/export, save patches, and undo/redo. Cloudflare integration tests use actual local workerd, D1, SQLite Durable Objects, and signed test JWTs verified by the Clerk backend SDK. They check authentication, account isolation, atomic writes, retries, conflicts, and deletion behavior.

## Renderer and persistence browser checks

Build and serve the separate benchmark harness:

```sh
bun run build:benchmark
bun run preview:benchmark
```

Open `http://127.0.0.1:5174/`. The harness uses the app's editor, renderer, controller, IndexedDB worker, and save session. Its scene contains 2,000 equipment items, 2,500 connectors, and four 500-tap buses. Append `?renderer=webgpu` to compare renderers with the same scene. The harness and its debugging globals are excluded from the application deployment.

Evaluate the following browser scripts in the harness page, using browser developer tools or automation:

- `tests/browser/measure.js`: opening, panning, moving 1,000 selected items, duplication, and local-save measurements.
- `tests/browser/source-colors.js`: run after `measure.js`; checks source connectivity, selection colors, and GPU recovery.
- `tests/browser/persistence.js`: save serialization, pending mutations, offline reloads, retries, conflict recovery, and storage errors.
- `tests/browser/labels.js`: private label layout persistence, offline retries, account isolation, and recovery copies.

The `/arrangement.html` page mounts the actual React Workspace. Evaluate `tests/browser/arrangement.js` there to check toolbar behavior, geometry, history, persistence, and JSON round-trips.

Measure performance from the production-built harness. Timings cover synchronous CPU submission through `app.render()`, not GPU completion or end-to-end input-to-paint latency. The harness omits authentication and remote network latency. Report the machine, browser, viewport, device-pixel ratio, renderer, and workload when comparing results. Reused-process heap measurements are not clean-start memory budgets.

## Symbol strokes

```sh
bunx vite --config vite.benchmark.config.ts
```

Open `http://127.0.0.1:5174/symbols.html` and evaluate `tests/browser/symbol-strokes.js`. This disposable scene has no persistence. The script checks WebGL pixel coverage for all equipment types across rotations, zoom levels, selection states, and connected breaker/disconnect seams, then restores the scene. This page is available through the development server; it is not a benchmark build entry.

## Model URLs

With `agent-browser` installed, start a dedicated local demo server:

```sh
VITE_LOCAL_DEMO=true bunx vite --host 127.0.0.1 --port 5186
```

Then, from another terminal:

```sh
node tests/browser/model-urls.mjs
```

The script restricts its target to localhost and creates isolated local test models. It covers stable model URLs, refresh with saved edits, Back/Forward, returning to the library, direct links, missing or malformed models, failed saves, canceled navigation, renaming, and cross-tab locks. Its injected save and lock delays apply only to the local browser test session.

## Release coverage

Verify sign-in, authenticated persistence, and cross-account isolation with disposable accounts in the intended deployment environment. `tests/browser/live-api.js` exercises the signed-in API and cleans up its test project. Production authentication has no anonymous bypass.

Chromium has been exercised. Safari and Edge still need end-to-end sign-in, persistence, and isolation checks. Input-to-paint latency and performance on additional reference laptops remain unverified; CPU submission measurements alone do not establish a no-dropped-frame guarantee or 120 Hz support.
