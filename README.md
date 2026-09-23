# PowerSystemsModelToJSON

A desktop one-line editor built with React, a custom TypeScript graph editor, PixiJS, Clerk, and Cloudflare. Equipment owns its world position and engineering metadata. Connector endpoints own graph connectivity; portable JSON also contains derived equipment backlinks.

**PowerSystemsModelToJSON** is deployed at [powersystemsmodeltojson.com](https://powersystemsmodeltojson.com), with a production Clerk instance and isolated Cloudflare storage. The [Cloudflare preview](https://powersystemsmodeltojson-preview.christophergabba.workers.dev) remains available with its existing projects. Repeatable checks and browser/performance coverage are in the [validation guide](docs/validation/README.md).

## Run

Use Node 22 or newer and Bun 1.2 or newer. Dependencies are pinned in `package.json` and `bun.lock`.

```sh
bun install --frozen-lockfile
cp .env.example .env.local
cp .dev.vars.example .dev.vars
bun run db:local
bun run dev
```

Set the Clerk publishable key in `.env.local` as `VITE_CLERK_PUBLISHABLE_KEY`. Set both `CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` in `.dev.vars`. Keep secrets out of `VITE_` variables. Configure Google and email verification codes in the dedicated Clerk application. Password sign-in is disabled for the provisioned development instance.

For a local editor-only development session, run `VITE_LOCAL_DEMO=true bun run dev`. This mode is compiled out of production. Production has no anonymous editor or authentication bypass. Missing Clerk configuration fails closed.

## Editing

Each model opens at `/models/<id>`. Refreshing or reopening that URL restores the same model, including locally saved changes. Browser Back/Forward and the Models button navigate between the editor and your model library. Model URLs survive renaming and still require the owning account to sign in.

Drag an item from the bottom palette onto the canvas, or click an item and then click the canvas. Hold Shift when dropping or clicking to keep placing that equipment. Escape or dropping outside the canvas cancels a palette drag. Double-click equipment for its inspector. Drag a terminal to another free terminal or a bus. Available nearby terminals also snap and connect when equipment is dropped. Drag a bus bar to move it; connections can only be initiated from other equipment. Select a bus to resize either end or rotate it with Ctrl + R. Existing taps stay fixed during resizing. Select a connector and drag a segment handle to adjust its orthogonal route.

Equipment and connectors appear light gray when they have no connector path to a utility or generator. This follows the physical graph in either direction, including rings; visual groups and configured failovers do not provide a connection. Selected symbols turn blue without a surrounding selection box. Bus resize handles and terminal connection points remain available.

Failover trigger picks save immediately with each click or completed box selection, and the sidebar list updates as you select. Click a selected trigger again or use its sidebar remove button to remove it. Stop selecting triggers, Esc, or closing the inspector exits selection mode without reverting changes. Picking a failover target on the canvas saves it immediately and exits target selection. Each click or box selection can be undone.

Selecting equipment highlights its configured failover triggers in orange and its failover target in purple, including their labels. Equipment with failover links stays pink. If a target is also selected, a trigger, or an owner of failover links, a purple target marker identifies it while retaining its existing symbol color. Highlights clear when the owning equipment is deselected. Labels default to the right of equipment, centered vertically; existing manually positioned labels retain their placement. Drag any equipment label to reposition it independently (Shift constrains movement); undo/redo includes each label move. Labels stay upright and follow equipment movement. Double-click equipment or its label to open the inspector. Once open, the panel follows subsequent equipment and label selections, including clicks within a selected group. Pending valid field edits commit to the previous item before switching, and each item gets its own field drafts. Closing the inspector restores single-click selection without reopening it.

Labels show ID, kV, amps, derating multiplier, and three-phase derated MVA: `√3 × kV × A ÷ 1,000 × derating multiplier`. The [three-phase apparent-power relationship](https://www.se.com/us/en/faqs/FA101600/) uses line-to-line voltage. Unknown ratings display an em dash; zero remains zero. MVA is displayed to three decimal places and recalculates when ratings change. Zooming out reduces labels to IDs, then hides them.

Label offsets are private project view settings keyed by immutable equipment keys. They save locally through the same IndexedDB worker and synchronize every two seconds to an owner-checked `/api/projects/:id/view` endpoint. They survive offline reopening, retries, ID changes, and recovery-project creation. They do not change the electrical document, its engineering revision, or exported/imported JSON. New imports use default label positions.

| Action               | Shortcut                                                      |
| -------------------- | ------------------------------------------------------------- |
| Select / hand        | V / H                                                         |
| Pan                  | Hold Space and drag, middle drag, or ordinary trackpad scroll |
| Zoom                 | Ctrl/Cmd + scroll, or + / −                                   |
| Find equipment by ID | Ctrl/Cmd + F                                                  |
| Fit model            | F                                                             |
| Add to selection     | Shift + click or marquee                                      |
| Duplicate            | Alt + drag, Ctrl/Cmd + Shift + drag, Ctrl/Cmd + D             |
| Rotate 90° clockwise | Ctrl + R                                                      |
| Group / ungroup      | Ctrl/Cmd + G / Ctrl/Cmd + Shift + G                           |
| Copy / paste         | Ctrl/Cmd + C / V                                              |
| Undo / redo          | Ctrl/Cmd + Z / Ctrl/Cmd + Shift + Z                           |
| Delete               | Delete or Backspace                                           |
| Cancel               | Escape                                                        |

When multiple items are selected, the second row of the selection toolbar aligns top/middle/bottom or left/center/right. With at least three items or groups, distribute them with equal horizontal or vertical gaps, keeping the first and last items fixed. Complete groups move as units; ungroup to arrange their individual equipment. Arrangement uses rotated equipment bounds and ignores labels. Existing connections and bus taps stay attached, labels follow equipment, and every action is one undo step. Arrangement does not create new connections. Manual bends travel with endpoints that share a translation; other manual bends keep their world positions while the endpoints reroute.

Shortcuts act when the canvas has focus and leave inspector text editing alone. Each completed gesture is one undo operation. Duplicated equipment gets unique IDs by incrementing trailing numbers (`breaker_1` → `breaker_2`, `transformer_01` → `transformer_02`) and skipping IDs already in use. IDs without a trailing number start at `_1`. Copies retain ratings and internal wiring, detach external wiring, and clear failovers. Groups are visual and never change equipment coordinates.

The breaker types are `indoor_drawout_breaker` and `outdoor_mv_hv_breaker`. They use the indoor drawout symbol and an outdoor square with centered top and bottom leads respectively, each with `in` and `out` terminals. Equipment IDs and exported JSON use these type names. `disconnect_switch` uses two circular contacts and an open angled blade, with `in` and `out` terminals. Its diagram size and terminal spacing are 75% of the original size; saved routes using the former terminal positions are adapted when opened or imported. Its icon does not simulate an open/closed state. The RMU has two upper terminals (`left`, `right`) and a lower feeder. Oil-filled and dry-type transformers share the same base artwork, with an oil drop inside the oil-filled symbol's lower circle. All electrical strokes use one 1.4-unit line weight, including busbars, leads, and selected connectors. Shared vector paths render the canvas, palette, inspector, and sign-in example; each symbol includes its full leads to the catalog terminals, avoiding raster/lead overlap. The original GPT Image Gen artwork remains as reference, with prompts and revisions in `docs/symbol-prompts.json` and `docs/symbol-revisions.json`.

## Portable model

Export writes schema version 1, model name/revision/date, equipment, connectors, failovers, and viewport. Visual groups remain saved in the editor but are omitted entirely from exported JSON. Older files containing groups can still be imported. Equipment uses center coordinates, positive X right, positive Y down, and clockwise rotations in 90° steps. Buses export their length and connectors export tap offsets relative to the bus center. Connectors include terminal endpoints, start/bend/end points, routing mode, and manual bend anchors. Plain connectors have no engineering ratings; cable is equipment.

Internally, immutable keys preserve relationships across editable equipment ID changes. Internal keys are not exported. Import validates schema, IDs, dates, terminal capacity, references, coordinates, orthogonal routes, backlinks, failovers, and group membership, then creates an independent project with fresh internal keys. Import/export runs in a dedicated worker. Incomplete ratings and failovers may be saved while editing but block export. Every equipment component, including buses and cables, must have both voltage (kV) and current (A); zero is a supplied value. Export checks list the affected equipment IDs and missing values. Double-click an error (or focus it and press Enter) to center the component and open its properties. Ctrl/Cmd + F searches equipment IDs, including partial and case-insensitive matches; use the arrow keys and Enter to locate a result, or Escape to close search.

## Naming and compatibility

The project folder and package use the new name. The public preview is `powersystemsmodeltojson-preview.christophergabba.workers.dev`. Its thin entry Worker forwards through a Cloudflare service binding to the existing authenticated application, so both preview URLs use the same D1 database, Durable Object namespace, users, and projects. The previous preview URL remains usable for existing tabs and offline caches. Localhost remains `http://127.0.0.1:5173/`.

The original IndexedDB name, browser-lock prefix, local Worker name, and provisioned database/service identifiers are intentionally stable storage identities. Do not rename or recreate these to change branding. New clipboard writes use `PowerSystemsModelToJSON_CLIPBOARD`; pasted content from the old prefix remains accepted. Production configuration requires an explicit authorized origin before deployment.

## Persistence and ownership

Completed operations are sent to a worker for validation and IndexedDB persistence. A two-second loop sends dirty changes to the API with one request in flight. Mutation IDs and expected revisions survive reloads. The project Durable Object validates and commits each patch in one SQLite transaction. D1 indexes project ownership and summaries. Every project API route verifies Clerk authentication and ownership; the Durable Object also checks ownership.

Already-open models remain editable offline. Local changes survive reload; fresh sign-in needs a connection. A conflicting device edit or deleted cloud model creates a separate, named recovery project. The original cloud document is not overwritten. A browser Web Lock prevents two tabs from editing the same local record. Storage failures remain visible and prevent closing without a durable local save.

## Validate

```sh
bun run test
bun run build
bun run build:benchmark
bun run preview:benchmark
```

The runtime tests use actual workerd, D1, SQLite Durable Objects, and locally signed test JWTs verified by Clerk. They do not mock authentication. Browser scripts in `tests/browser` exercise the compiled worker and renderer through the separate benchmark harness. The harness is never included in the application deployment.

`tests/performance` contains the 2,000-equipment / 2,500-connector scene, including four buses with 500 taps each. Add `?renderer=webgpu` for an identical WebGPU comparison. See the [validation guide](docs/validation/README.md) for browser checks and measurement limitations. Keep screenshots, raw reports, and other temporary validation output outside the repository, in an OS temporary directory.

## Cloudflare preview and release

The `preview` and `production` Wrangler environments use separate D1 databases and Durable Object namespaces. Choose the environment at build time:

```sh
CLOUDFLARE_ENV=preview bun run build
bunx wrangler d1 migrations apply power-reliability-modeler-preview --remote --env preview
bunx wrangler secret put CLERK_SECRET_KEY --env preview
bunx wrangler deploy
bunx wrangler deploy --config wrangler.preview-entry.jsonc
```

Configure the matching non-secret `CLERK_PUBLISHABLE_KEY` and `CLERK_AUTHORIZED_PARTIES` in that environment, and the frontend key at build time. A deployed preview must be validated before a production build. Production requires a Clerk production instance, its Google OAuth setup, and a registered production domain with a Cloudflare route. Never deploy development keys as production credentials. The initial preview infrastructure was provisioned through the authenticated Cloudflare connector; Wrangler CLI authentication is a separate setup.

Production uses the `powersystemsmodeltojson` Worker and D1 database, with custom domains for the apex and `www`. Clerk's five DNS-only CNAME records are verified. Email-code sign-up/sign-in is enabled and passwords are disabled. Production builds explicitly select the live publishable key in `vite.config.ts`, so the development key in `.env.local` cannot override it. The secret key is a Cloudflare secret binding and is never included in client assets.

Google sign-in uses the dedicated Google Cloud project `powersystemsmodeltojson` and a production web OAuth client. Its origins are the apex and `www`, and its callback is `https://clerk.powersystemsmodeltojson.com/v1/oauth_callback`. Google OAuth is published for external production users and uses only basic identity, email, and profile scopes. The Google client secret is stored in Clerk. The approved public [Privacy Policy](https://powersystemsmodeltojson.com/privacy/) and [Terms of Service](https://powersystemsmodeltojson.com/terms/) are linked from the sign-in page and Google consent screen.

```sh
bunx wrangler d1 migrations apply powersystemsmodeltojson --remote --env production
# Only when setting or rotating the production secret:
bunx wrangler secret put CLERK_SECRET_KEY --env production
bun run deploy:production
```

Preview and production have separate Clerk users, databases, and browser caches. To move a preview model, export its JSON and import it after signing into production. Never reassign project ownership using an unverified mapping between environments.

No studies, load flow, short-circuit calculation, uploaded photos, shared editing, or full touch editing are implemented. Automatic obstacle avoidance is deferred; paths are orthogonal and user-adjustable.
