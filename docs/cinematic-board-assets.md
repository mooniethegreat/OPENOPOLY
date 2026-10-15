# Cinematic board presentation

The live board remains the existing React/CSS 3D scene. Property IDs, picking, legal actions, dice outcomes, token paths, ownership, and balances continue to come from the existing board definitions and authoritative room state. No renderer dependency or second game state was added.

## Source and asset manifest

| Asset | Source and permission/provenance | Scale / loading path | Modifications |
| --- | --- | --- | --- |
| Walnut table and evening room | Original image generated for this project from text; no approved-reference crops or baked game/UI | 1672×941; `/assets/cinematic/evening-lounge-original.png` | Shared app backdrop; gameplay uses the tabletop crop, menu keeps the wider room |
| Board face / labels | Existing `shared/board.js` data and edition names | Live 960-unit CSS board; `src/Board.jsx` | Warm ivory print, dark backing, felt center; original group colors and edition labels retained |
| Architectural city kit | Original procedural CSS geometry authored in the project | Ten distinct silhouettes in `src/Board.jsx` / `src/board-scene.css` | Setbacks, cornices, varied slate/stone roof caps, civic colonnades, clock, lantern/spire, facade/window treatments; rear interior placement |
| Eight metal token meshes | Original procedural vertex/face geometry authored in the project | `src/token-geometry.js` → `src/MeshToken.jsx`; existing hat/car/dog/ship/cat/penguin/thimble/duck IDs | Shared board/portrait/winner geometry, silver lighting, optional winner gold, stable token overlap offsets |
| Original token photo fallback | Existing project reference image; original provenance remains in `public/assets/sources.json` | `/assets/reference/classic-set.png`; explicit `Token fallback` prop | Existing crop coordinates remain available; default token rendering uses original mesh geometry |
| Dice / real houses and hotels | Existing physical six-face dice and game-driven CSS pieces | `src/dice-geometry.js`, `src/Board.jsx` | Ivory/dark-pip material preserved; real green/red developments remain separate from the decorative city |
| Card decks | Original procedural CSS paper stacks; existing edition labels and card artwork remain | `src/board-scene.css`, `/assets/card-art/` | Blue Chest and ochre Chance materials and paper edges |
| Reaction stickers | Original SVG faces, hand and friendly pile authored in the project | `src/EmoteArt.jsx` | Six named emotes; no external sticker asset or video dependency |

## Rendering and interaction boundaries

- Tokens are procedural 3D mesh projections rendered as depth-sorted, shaded SVG polygons. They are stylized miniatures, not photorealistic scanned models. Each model has at most 256 faces; projected views use a bounded 96-entry cache. Memoized token views do not create WebGL contexts or one compositing layer per mesh face.
- The miniature city is memoized independently of camera position and HUD countdowns. It remains decorative; only real property development pieces reflect ownership/building state.
- Gameplay uses a 34° CSS pitch on desktop and 30° on compact screens; scenic previews/lobby retain a lower, 54° pitch. Overview is the entry/reset view. Follow is explicit and uses restrained zoom.
- Camera and perspective share the measured usable window center. The pure fit solver includes the wood rim and elevated corner-token margins. Phone framing uses actual header/location/action/wallet bounds; desktop fitting excludes the camera bar and visible drawer. Manual pan/zoom remains finite and RAF-coalesced, with the existing release/cancel/blur safeguards.
- Emotes consume canonical ephemeral socket events through the existing hook. They never issue game actions or change money/turn state. At most three overlays exist, expire at the shared server deadline, and clear when hidden/disconnected. The effect uses a bounded geometry snapshot plus one finite camera-settle remeasure, not continuous layout reads.

## Review evidence

Composition baseline and first review: `.runtime/inspection/cinematic-cycle1/`. The initial desktop follow crop was rejected and changed to complete overview.

Second actual composition: `.runtime/inspection/cinematic-board-cycle2/`. Material contact-sheet baseline: `.runtime/inspection/cinematic-token-review/token-material-sheet.png`. That review led to volumetric dog/cat bodies, a lower open roadster, and more distinct duck/penguin silhouettes. Later captures use separate output directories so these review baselines remain available.

Focused checks are in `tests/board-camera.test.js`, `tests/token-geometry.test.js`, `tests/e2e/board-camera.spec.js`, and `tests/e2e/emotes-visual.spec.js`. Final combined source/build and review status is recorded by the parent release task; this document does not imply a production rollout.

Remaining art gap: architecture and metal pieces are deliberately stylized procedural geometry. Their forms, shading and depth materially improve the original blocks/photo billboards, but do not reproduce the reference's photorealistic city models, detailed sculpting, reflections or volumetric room lighting.
