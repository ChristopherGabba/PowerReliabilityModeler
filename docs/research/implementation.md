# Implementation integration research

Verified 2026-09-21 against current official documentation and upstream source. These are integration recommendations, not performance measurements. Resolve and lock package versions before treating moving `release` documentation or `dev` source as the installed implementation.

## PixiJS v8 rendering

Use Pixi as the graphics backend for our own editor model and interaction engine. The current renderer guide recommends WebGL for production and describes WebGPU as experimental. Prefer WebGL2 initially and benchmark a WebGPU option separately. [Renderer guide](https://pixijs.com/8.x/guides/components/renderers)

```ts
const app = new Application()
await app.init({
  preference: 'webgl',
  preferWebGLVersion: 2,
  autoStart: false,
  sharedTicker: false,
  resolution: Math.min(window.devicePixelRatio || 1, 2),
  autoDensity: true,
  antialias: true,
})
host.appendChild(app.canvas)
```

`init` is asynchronous; constructor options are the old API. `autoStart: false` with a private ticker lets the editor coalesce invalidations into one `requestAnimationFrame` callback calling `app.render()`. `app.stop()` stops automatic rendering if already started. An existing shared ticker is not stopped by `autoStart: false`. Resolution and antialiasing must be benchmarked; the cap above is our proposed policy. [Application guide](https://pixijs.com/8.x/guides/components/application), [Application API](https://pixijs.download/release/docs/app.Application.html)

Guard asynchronous initialization against component unmount, then cancel pending animation frames and destroy the app during cleanup. React should manage surrounding UI; transient camera and pointer updates should mutate renderer state through the editor boundary, not rebuild a React tree per equipment item. This is our architecture recommendation, not a Pixi-provided editor feature.

## Geometry, assets, labels, and coordinates

V8 Graphics builds a path first and applies its fill/stroke afterward:

```ts
wire
  .clear()
  .moveTo(x0, y0)
  .lineTo(x1, y1)
  .lineTo(x2, y2)
  .stroke({ color: 0x55606c, width: 2, cap: 'round', join: 'round' })
```

Retain geometry until its route changes; moving a group should update transforms. Repeated vector symbols can share a `GraphicsContext`, passed to `new Graphics(context)`. Destroying that shared context destroys every Graphics using it, so do not use `{ context: true }` when deleting only one instance. [Graphics API](https://pixijs.download/release/docs/scene.Graphics.html), [Graphics guide](https://pixijs.com/8.x/guides/components/scene-objects/graphics)

For generated symbol artwork, load each source once with `await Assets.load(url)` and reuse its Texture across `new Sprite(texture)` instances. Texture is a lightweight view into a TextureSource; atlas frames can share the same source. Deleting one equipment instance must not destroy its shared texture. `texture.source.unload()` releases GPU storage while retaining the source; `Assets.unload(url)` releases an asset when no instances need it. Decoding/loading is not the same as GPU upload, so first-use stalls still need measurement. [Textures](https://pixijs.com/8.x/guides/components/textures)

Use object constructors: `new Text({ text, style: { fontFamily, fontSize, fill } })` or `new BitmapText({ text, style: { fontFamily, fontSize, fill } })`. Text rasterizes a string into a texture; changing its text/style rerasterizes it. Load fonts before creating labels. BitmapText shares glyph atlases and supports BMFont/MSDF assets; it is the preferred candidate for thousands of IDs. It does not support dynamically changing `resolution`; broad Unicode coverage may require ordinary Text fallback. Hide illegible labels at distant zoom as an editor policy. [Text](https://pixijs.com/8.x/guides/components/scene-objects/text/canvas), [BitmapText](https://pixijs.com/8.x/guides/components/scene-objects/text/bitmap)

`renderer.events.mapPositionToPoint(point, event.clientX, event.clientY)` maps DOM coordinates into Pixi screen coordinates, accounting for canvas position, CSS scale, and resolution. Then invert the editor camera transform to obtain world coordinates. Federated events already expose mapped `event.global`, and `event.getLocalPosition(container)` performs local conversion. [EventSystem API](https://pixijs.download/release/docs/events.EventSystem.html)

For our custom hit index and pointer capture, set visual containers to `eventMode = 'none'` and use native canvas pointer listeners. Otherwise Pixi traverses its display tree for hits. In v8, `pointermove` fires over hit objects; `globalpointermove` is the corresponding all-moves event. Disable redundant event features if keeping Pixi's EventSystem for coordinate mapping. [Event guide](https://pixijs.com/8.x/guides/components/events)

## Context recovery

Pixi's GlContextSystem installs loss/restoration listeners, prevents default loss behavior, and emits its internal context-change runner after restoration. The renderer already manages recovery of its systems; app code should retain the independent document and image sources, invalidate after restoration, and offer a renderer rebuild if recovery fails. Do not call protected internal handlers. [Upstream GlContextSystem source](https://github.com/pixijs/pixijs/blob/dev/src/rendering/renderers/gl/context/GlContextSystem.ts)

A Text/HTMLText context-restoration fix was merged into upstream `dev` on September 7, 2026. Its inclusion in the exact installed release must be checked; merge status alone is not evidence of a released fix. Exercise forced context loss with wires, shared symbols, photos, and labels before relying on automatic recovery. [Upstream fix #12170](https://github.com/pixijs/pixijs/pull/12170)

## Clerk React and Workers

The current plain React SDK is `@clerk/react`. Wrap the app with `ClerkProvider` using `import.meta.env.VITE_CLERK_PUBLISHABLE_KEY`. Core 3 uses `<Show when="signed-in">` and `<Show when="signed-out">`; the old SignedIn, SignedOut, and Protect exports were removed. `SignIn` and `UserButton` remain available. [React quickstart](https://clerk.com/docs/react/getting-started/quickstart), [Show migration](https://clerk.com/docs/react/reference/components/control/show)

`useAuth()` supplies `isLoaded`, `isSignedIn`, `userId`, and `getToken`. Wait for loading before deciding which UI to display. `await getToken()` returns `string | null`; handle null before constructing a Bearer header. Same-origin requests can carry Clerk's session cookie; Bearer tokens support an explicit API transport and cross-origin requests. [useAuth](https://clerk.com/docs/react/reference/hooks/use-auth), [Making requests](https://clerk.com/docs/guides/development/making-requests)

`SignIn` reflects configured Clerk instance strategies. Enable Google plus the selected email strategy in the Clerk dashboard; JSX alone does not configure those strategies. [SignIn](https://clerk.com/docs/react/reference/components/authentication/sign-in)

`@clerk/backend` supports Cloudflare Workers directly; no separate Cloudflare Clerk SDK is needed. Read secrets from Worker `env` bindings:

```ts
const clerk = createClerkClient({
  publishableKey: env.CLERK_PUBLISHABLE_KEY,
  secretKey: env.CLERK_SECRET_KEY,
})
const state = await clerk.authenticateRequest(request, {
  acceptsToken: 'session_token',
  authorizedParties: allowedOrigins,
})
if (!state.isAuthenticated) return new Response('Unauthorized', { status: 401 })
const { userId } = state.toAuth()
```

Use a configured origin allowlist, not arbitrary request-origin reflection. `jwtKey` enables networkless verification when configured with the Clerk public key. Every project query/mutation must additionally enforce ownership using the authenticated userId; UI gating is not authorization. [authenticateRequest](https://clerk.com/docs/reference/backend/authenticate-request), [Official raw Workers example](https://clerk.com/articles/authentication-for-serverless-and-edge-deployments-2)

## Cloudflare Vite local backend and deployment

Use `plugins: [react(), cloudflare()]` from `@vitejs/plugin-react` and `@cloudflare/vite-plugin`. Wrangler's `main` identifies the Worker API entry. Set `assets.not_found_handling` to `single-page-application` and `assets.run_worker_first` to `["/api/*"]` so API navigations cannot silently become SPA HTML. The plugin determines the assets output directory. `vite` runs the API in local workerd with bindings; `vite build` produces both bundles and a generated Wrangler config; `vite preview` exercises that output locally. [React + Vite](https://developers.cloudflare.com/workers/framework-guides/web-apps/react/), [Static assets](https://developers.cloudflare.com/workers/vite-plugin/reference/static-assets/)

Choose named environments at **build time**: `CLOUDFLARE_ENV=preview vite build`, followed by `wrangler deploy`. The generated config is flattened for that environment. A default build followed only by `wrangler deploy --env preview` is not the documented Vite deployment sequence. Vite `--mode` and Cloudflare environment selection are distinct unless explicitly connected through env files. [Cloudflare environments](https://developers.cloudflare.com/workers/vite-plugin/reference/cloudflare-environments/)

Keep server secrets in untracked `.dev.vars` for local work; only the publishable frontend key receives a `VITE_` prefix. The plugin copies `.dev.vars` into build output for local preview but does not deploy that file. Do not publish the whole local build directory elsewhere without accounting for it. [Secrets](https://developers.cloudflare.com/workers/vite-plugin/reference/secrets/)

## Verification still required

- Resolve actual package versions and type-check the implementation against them.
- Verify refresh/deep-link/API routing under `vite preview`, then the chosen Cloudflare environment.
- Verify Clerk sign-in, expired/missing-token rejection, and cross-user project isolation with configured test credentials.
- Benchmark 2,000 equipment items plus a declared wire count, 1,000-item move/duplicate, resizable buses, zoomed-out labels, photos, autosave, and GPU context recovery. Measure CPU/frame time, input latency, first-upload stalls, and memory at 1x/2x resolution; FPS alone is insufficient.
