# Validation record — 2026-09-21

## Automated checks

- 51 graph/editor, catalog, label, arrangement, and inspector tests: complete JSON round trip, backlinks, ID rename, malformed input, cyclic graphs, transforms, internal-wire duplication, numbered-copy IDs, collision handling, source connectivity, failover cleanup, single-step undo, patch replay, bus capacity and resizing, spatial culling, equipment-type compatibility, disconnect-switch terminals, and the release-scale fixture.
- 6 Cloudflare integration tests using real local workerd, SQLite Durable Objects, D1, and RSA-signed test JWTs verified by the real Clerk backend SDK. Cover missing/expired/invalid/wrong-origin sessions, cross-account list/read/write/delete/create isolation, atomic patch validation, retries across equipment-type renames, conflicts, interrupted creation, and deletion tombstones.
- Browser-worker tests verify a single request in flight, edits during an in-flight save, durable pending mutation IDs, offline reload recovery, retry, conflict recovery into a distinct project, and actionable storage errors. Raw results: `persistence-browser.json`.

## Deployed preview checks

The authenticated PowerSystemsModelToJSON preview is live at https://powersystemsmodeltojson-preview.christophergabba.workers.dev. The previous preview URL remains usable with the same projects and authentication. Production deployment was subsequently authorized; see the production deployment record below.

- Signed in through Clerk's actual email-code UI with two disposable development test users. No authentication bypass was used. Google sign-in is configured, but its interactive OAuth flow has not been exercised.
- Created and saved private projects against the deployed D1/SQLite Durable Object API. Verified idempotent retries, revision conflicts, and unauthenticated rejection (`live-preview.json`).
- The second signed-in account saw an empty project list and received 404 for read, change, and delete requests against the first account's project (`live-isolation.json`).
- Checked duplication, rotation, undo, inspector editing, ID rename, bus expansion with fixed taps, group shortcuts, failover trigger picking, and alternate-parent search. Exported through the UI, checked all equipment backlinks, and imported the file through the file input into a separate project. Metadata, world coordinates, connector paths/endpoints, groups, and failovers survived (`live-interactions.json`).
- Simulated WebGL context loss and restoration in the production-built harness. The complete document was unchanged; all 2,000 equipment items and 2,500 connectors rendered after recovery (`gpu-recovery.json`).
- Captured the final deployed canvas in `live-preview.png`. All 19 automated tests passed after the final controller/render scheduling change.

## Sign-in screen update

The sign-in page now presents a main-tie-main example built from the existing generated symbol assets and a matching model. Selecting equipment updates the syntax-highlighted JSON; the download contains the complete importable example (11 equipment items, 10 connectors). Verified selection, JSON parsing/import/export equality, and layouts at 1440 × 1000 and 390 × 844 without horizontal overflow. The TypeScript/production build and changed-file formatting checks pass. The local authenticated development server runs at http://127.0.0.1:5173 with local database migrations applied. This local database is separate from the hosted preview.

## Reference machine and measurement

### Source connectivity and selection colors

Equipment and connectors without a physical path to a utility or generator now use light gray. Reachability is cached and invalidated only by equipment/connector topology changes; dragging, rotating, and editing ratings do not repeat the graph traversal. Shared white alpha masks make the original symbol ink tintable without per-item filters. Every selected symbol turns blue, including selections over 50 items, and the surrounding selection rectangle is removed. Marquee selection, terminal points, and bus resize handles remain available.

All 31 tests pass. Browser framebuffer checks verify gray/dark/blue ink, connect/delete/undo color updates, blue coloring for 1,000 selected symbols, absent selection/drag boxes, and GPU restoration (`source-colors-browser.json`, `source-colors.png`). The same large scene measured 10.3 ms median / 11.7 ms p95 movement submission, 9.9 ms duplication, 498 ms opening, and no save-related tasks over 50 ms (`source-colors-benchmark.json`). Maximum movement submission was 23.3 ms. These retain the measurement limitations below.

To reproduce the visual checks, run `tests/browser/measure.js` and then `tests/browser/source-colors.js` in the production benchmark harness.

### Original renderer comparison

Apple M2 Pro, 10 logical CPUs, 16 GiB RAM, macOS 26.6.2. Chromium 148 through agent-browser; ANGLE Metal on Apple M2 Pro. Viewport 1440 × 1000, device-pixel ratio 1. No CPU throttling. Other applications were running. These are browser measurements, not a claim of universal frame rates.

The separate production-built renderer harness uses the same editor, renderer, controller, IndexedDB worker, and save session as the app. It omits the React application shell and remote authentication/network latency. The scene contains 2,000 equipment items, 2,500 connectors, and four 500-tap buses; all are visible at fit-to-content. The movement case previews a 1,000-item selection over 90 animation frames. Timings include synchronous CPU submission through `app.render()`, not GPU completion or end-to-end display latency.

| Metric                                            |         WebGL2 |         WebGPU |
| ------------------------------------------------- | -------------: | -------------: |
| Open through first render, warm HTTP assets       |         331 ms |         447 ms |
| Pan, median / p95                                 |   5.6 / 6.5 ms |  9.1 / 10.2 ms |
| Move 1,000 items, median / p95                    | 10.5 / 12.1 ms | 12.3 / 16.1 ms |
| Move maximum observed frame                       |        20.5 ms |        23.8 ms |
| Duplicate 1,000 items, synchronous command        |        10.5 ms |         9.0 ms |
| Main-thread long tasks during isolated local save |   0 over 50 ms |   0 over 50 ms |
| Observed JS heap after workload                   |         225 MB |         279 MB |

Heap readings reflect the reused browser process and are not a clean-start memory budget. GPU/texture allocations are not included. The raw JSON captures are alongside this document. WebGL stays the default: its p95 is below the 16.7 ms interaction target on this machine and it outperformed WebGPU. Maximum-frame outliers exceed 16.7 ms, so a strict no-dropped-frame acceptance has **not** been established. 120 Hz is not validated.

The first development-mode run was invalidated by hot reload closing the active save worker; this was diagnosed using the session state, and the isolated production build completed save/recovery checks. The worker now rejects requests after disposal instead of leaving them unresolved.

## Failover highlights and private labels

All 36 automated tests pass, including three-phase derated MVA, missing/zero ratings, label history and JSON exclusion, movement/rotation/rename/copy behavior, trigger highlight invalidation, and owner-isolated label storage with atomic validation.

Browser checks verified native pointer label dragging, Escape cancellation, undo/redo, live rating/MVA text, blue selected symbols with orange triggers, and visible detached labels whose equipment is offscreen. Geist is loaded before generating the shared bitmap font atlas. Screenshot: `failover-labels.png`. Existing source-color/GPU-recovery checks continue to pass.

`tests/browser/labels.js` verifies offline layout retries, merging cloud view settings with unsynced local edits, local account isolation, one network request in flight, edits during a view save, unchanged model revision/JSON, offline reopening, and retaining layout in a recovery project. Existing persistence tests still pass.

The deployed preview serves the current build and rejects unauthenticated view mutations. The local Cloudflare integration tests verify owner save/reload, idempotent retry, cross-account read/write rejection, unchanged model/revision, and atomic malformed-view rejection. A direct backend-created Clerk session could not exercise the live endpoint because its token lacked the required authorized-party claim; the Worker correctly rejected it. The disposable test users were removed.

The same M2 Pro / Chrome 148 / 1440 × 1000 harness measured 484 ms opening, 7.3 / 8.9 ms median/p95 pan, 11.9 / 14.5 ms median/p95 movement, 12.7 ms duplication, and zero save-related tasks over 50 ms (`labels-benchmark.json`). Maximum movement submission was 31.1 ms. The reused-process JS heap was 214 MB; it is not a clean-start budget. These are CPU submission timings with the same limitations as the reference measurements below.

## Selection alignment and distribution

All 48 tests pass. The selection toolbar now exposes top/middle/bottom and left/center/right alignment, plus equal horizontal/vertical gaps for at least three items or groups. Fully selected groups move together. Tests cover mixed sizes, rotated equipment, several interior objects, group geometry, label following, bus taps, manual bends, retained metadata/failovers/connectivity, and a single undo/redo step. No-op commands do not add history entries, and arrangement never creates new connectors.

A related manual-routing issue surfaced during these tests: endpoint `Port` objects were being retained in the connector's strict `points` array. Manual routes now emit only `{ x, y }` points, allowing their changes to validate, persist, and round-trip normally.

The production-built Workspace harness (`http://127.0.0.1:5174/arrangement.html`) exercises the actual React toolbar, controller focus, IndexedDB autosave worker, and Pixi renderer. Native clicks and `tests/browser/arrangement.js` verify all eight buttons, single/two-item availability, group/ungroup availability, keyboard focus after clicking, one-step history, autosaved positions, and full JSON round-trip (`arrangement-browser.json`, `arrangement.png`). The harness is separate from the production authentication flow and is not deployed.

On the same M2 Pro / Chrome 148 benchmark scene, arranging 1,000 selected items among 2,000 equipment and 2,500 connectors took 32 ms for middle alignment, 40.6 ms for horizontal distribution, and 28 ms for vertical distribution. Each bulk undo restored the entire original document. These are synchronous command timings, not interaction frame timings or end-to-end latency.

## Default labels on the right

Labels without a manual placement now sit to the right of the rotated equipment bounds, with an 8-world-unit gap and vertical centering. Existing manually positioned labels retain their old anchor. Private label settings include an optional anchor for compatibility; zero legacy offsets adopt the new default. Copying and undo/redo preserve the correct anchor. These settings remain outside model JSON.

All 49 tests pass. A native pointer drag in the production Workspace harness verified the label does not jump on commit, undo restores the new right-side default, the anchor saves privately, and exported equipment remains unchanged. Screenshot: `right-side-labels.png`.

## Inspector follows selection

All 51 tests pass. An open equipment inspector follows subsequent equipment/label selection, placement, duplication, and undo/redo. Clicking another member of a selected group updates the inspector while retaining the group selection. Empty selection retains the panel; explicit closure keeps it closed. Failover picking stays on its owner.

Native browser double-clicks and single-clicks in the production Workspace harness verified that the panel stays mounted, pending edits save to the previous equipment and its JSON export, the next equipment shows its own ratings, invalid drafts do not leak between equal-valued fields, group-member clicks update the panel, and explicit closure prevents automatic reopening. Identity/rating field sections reset by immutable equipment key while the panel itself retains its position.

## Outdoor breaker and disconnect switch

The catalog includes the two-terminal `disconnect_switch` and the outdoor breaker. The breaker types are now `indoor_drawout_breaker` and `outdoor_mv_hv_breaker`; old type conversions and asset aliases have been removed. Catalog tests cover both types through placement, copying, save patches, connections, rotation, failovers, and JSON round-trip. A workerd test covers cloud saves and retries using both breaker types. Reusing a mutation ID with changed ratings still returns 409.

Both symbols were generated with built-in GPT Image Gen and inspected against a white background. The outdoor icon has no hatch marks; the disconnect uses vertically aligned circular contacts and an open straight blade. Native palette clicks and terminal dragging in the production Workspace harness verify all 11 catalog choices, placement, source connectivity, and JSON round-trip for both components. Unit tests also verify snapping, terminal capacity, rotated endpoints, group duplication, metadata, save patches, and undo/redo. Assets: `public/symbols/outdoor_mv_hv_breaker.png` and `public/symbols/disconnect_switch.png`; prompts: `docs/symbol-revisions.json`.

## PowerSystemsModelToJSON rename

The sign-in brand, project-list brand, page title and description, package/lockfile, benchmark names, development globals, and current documentation use the new name. The repository lives at `/Users/christophergabba/Documents/PowerSystemsModelToJSON`; the old path is a compatibility symlink. Model JSON is unchanged, existing clipboard payloads remain accepted, and IndexedDB, browser locks, D1, and Durable Object identities are retained.

All 57 tests and the TypeScript/production build pass. The sign-in page was visually checked at 1440 × 1000 and 390 × 844, with the exact name in DOM text and no horizontal overflow. The new preview entry uses a Cloudflare service binding to the existing authenticated application. Both preview URLs and localhost serve the new title, report configured authentication, and return 401 for unauthenticated project requests. Clerk's real sign-in form loads on the new URL.

The Clerk dashboard application label was subsequently confirmed as PowerSystemsModelToJSON. Existing development credentials, users, and sessions were retained.

## Production deployment

The user registered `powersystemsmodeltojson.com` in Cloudflare and authorized production rollout. The apex and `www` serve the production Worker over HTTPS. A separate production Clerk instance, D1 database, and SQLite Durable Object namespace isolate production from the existing preview.

All 57 tests and the production build pass. The built client contains the live publishable key, contains no development publishable key or secret key, and excludes the development harness. The production sign-in form and interactive main-tie-main JSON preview load successfully. Health returns configured authentication; missing and malformed sessions receive 401 for project requests (`production-smoke.json`). The preview and localhost still respond successfully.

Clerk's five DNS records are verified, including all three email records. The production dashboard confirms email verification codes for sign-up/sign-in, required email verification, and disabled passwords. The user created Google Cloud project `powersystemsmodeltojson` (project number `48882856024`) and accepted Google's API Services User Data Policy. Its dedicated web OAuth client is configured in production Clerk; the Google audience is External with publishing status In production. Only basic sign-in scopes are requested.

The reported `Missing required parameter: client_id` error was caused by the production Google connection being enabled with empty custom credentials. After creating and saving the client credentials, the real production sign-in button reached Google's account chooser, showed the correct domain and approved policy links, completed Google consent, and returned to the authenticated private workspace. Created a temporary model and placed a utility source through the UI. Autosave reached All changes saved, and a read-only production D1 query confirmed one equipment record and server revision 2 for that model. Reloading the production page and reopening the model retained the equipment and saved status. Deleted the temporary model through the UI; the workspace returned to zero models and a read-only D1 query confirmed its deletion tombstone. Results are recorded in `production-google.json`.

The user approved publishing the privacy and terms pages. Both return HTTP 200 independently of authentication and are linked from the production sign-in page and Google branding configuration. The TypeScript/production build and changed-file formatting checks pass. Existing sign-in card spacing changes were preserved.

## Reproduction

Run `bun run build:benchmark`, then `bun run preview:benchmark`. Open `http://127.0.0.1:5174/` in a dedicated browser session. Once `window.__PSMTJ__` exists, evaluate `tests/browser/measure.js`. Repeat with `?renderer=webgpu` on the identical scene. Evaluate `tests/browser/persistence.js` for storage/retry scenarios. The harness and its debug globals are excluded from production app assets.

## Release gates

- Verify end-to-end input-to-paint latency and performance on additional reference laptops, including Safari and Edge production builds.
- Repeat Google sign-in, authenticated persistence, and cross-account isolation checks in Safari and Edge; the Chromium production sign-in and persistence flow has passed. Edge is not installed on this reference machine.
