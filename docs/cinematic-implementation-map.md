# Cinematic presentation migration: implementation and asset map

The user's full execution brief in `Pasted text.txt` is the current visual authority. This document records the existing application and the reversible presentation migration; it does not authorize publication over the live deployment.

## Existing stack and authority

- React 19.1, Vite 6.3, Socket.IO 4.8, Express 5.1, Lucide React, plain CSS. No installed Three.js/WebGL renderer. Board is a 960-unit CSS 3D world with projected bounds, DOM picking, and screen-space controls.
- `src/App.jsx`: room create/join/recovery, authenticated socket, shared room state, action dispatch, modal/drawer/composer state. `useGame()` exposes room/game/visualGame/presentation, authoritative action API, pending/connection state, selections, and UI setters.
- `src/Board.jsx`, `src/board-camera.js`, `src/board-scene.css`: board mapping, geometry, fixed space IDs, camera, label fitting, tokens, decorative city, cards/dice. Keep all legal hit targets and the established gesture/recovery fixes.
- `src/GameHUD.jsx`: real player rail, current/next turn, own cash/cards, reachable tools, drawers, shared events/contracts. `src/mobile-game.css`: full-viewport continuous phone scene and full-screen sheets. `src/table-chrome.css`: cinematic screen-space material system.
- `src/GameControls.jsx`: state-dependent actions, property inspector, rules. `src/Panels.jsx`: properties, chat, activity, contracts, votes, money composer, contract composer, and all term/approval semantics. `src/Appearance.jsx`: existing four palettes and dark/light preference with host restrictions.
- `src/presentation.jsx`, `src/presentation-state.js`: authorized movement/dice/time presentation; never a second game-state authority.
- `src/PaymentFeedback.jsx`, `src/MoneyFlight.jsx`, `src/TurnCountdown.jsx`, `src/GameAudio.jsx`: accepted money presentation, deadlines, and user-controlled audio. Preserve these functions while restyling their containers.
- `src/use-emotes.js`, `src/emote-state.js`, socket event handler in `server/app.js`: authenticated transient emotes, separate from cash/turn commands; no persistence or replay.

One traced interaction: property tile click sets `selected` using its actual `space.id` → `PropertyModal` reads that board definition and live owner/permissions → legal management/purchase invokes `action` → App calls `prepareCommand` with a unique command ID and current decision context, latches pending, persists the recoverable request, and sends authenticated Socket.IO `action` → server validates and applies through `shared/engine.js` → `room:state` is ingested and the visual state updates. Restyling must preserve this chain and never construct a parallel ownership store.

## Six actual screen compositions

| Screen | Existing presentation seam | Implemented direction and owner |
| --- | --- | --- |
| Main menu / room lobby | App Welcome, lobby ActionBar, PlayerRail, Board preview | HUD: large clean red logo, vertical gold Play + dark Create/Join/Rules/Settings, scenery to the right, real room/session strip only when data exists. Board: lower diagonal preview preset. |
| Live match | App game stage, GameHUD, ActionBar, Board | HUD: full viewport, 204–228px left players, 176–208px contextual right actions, one compact turn module, slim utility dock. Board: cream physical board in the available safe region; walnut/room atmosphere and enlarged playable subject. |
| Property view | PropertyModal in GameControls | HUD: 760–960px desktop composition with ~40% miniature / 60% data; phone full-screen stacked/readable. Board art: shared static property miniature. Every number and legal action remains derived from real state. |
| Trade / contract | ContractComposer + TransferEditor + existing panels | HUD: two-sided participants and transfer rows, complete supported contract terms below, green final confirmation. No semantic simplification and no invented instant swap. |
| Results | Game finished state and ActionBar presentation seam | HUD: real winner, supported real statistics only, actual session actions. Board art: winner's true token identity with gold finish; short reduced-motion-safe celebration. |
| Settings | App settings/appearance/rules + GameAudio controls | HUD: functional Game/Audio/Appearance groups, dark setting rows, shared/local distinction. No dead account tab or unauthorized live rule toggle. |

The default cinematic experience is dark, per the selected reference. Existing explicit light appearance remains a working user option; cream panels must not leak into the default cinematic dark view. All six screens use the same charcoal/champagne/red system and original environment. The old two giant turn strips and large green board container must not coexist with the new layout.

## Original environment asset

`public/assets/cinematic/evening-lounge-original.png` is a newly generated original 1672×941 PNG (1,864,151 bytes), copied unchanged into the project. It was produced with the built-in imagegen tool from a text prompt only; no reference or repository image was uploaded. It contains warm lamps, shelves/plants, blue night windows, and an empty walnut table occupying approximately the lower 64% of the frame. It contains no board, pieces, dice, text, logos, or UI. Use it as room atmosphere behind the live scene. The exact prompt, provenance, hash, permission context and intended loading path are recorded in `public/assets/cinematic/manifest.json`.

Menu/settings may use cover positioning around center 42%; gameplay should favor the tabletop and keep geometric contact/board shadows coherent. Do not combine this grain with a second high-contrast grain layer. Do not blur the property perimeter. The generation is below 1920 pixels wide; verify quality at 1920 without claiming it is a 1920px source.

## Reuse, creation and remaining art gaps

| Asset family | Current source | Migration / acceptance |
| --- | --- | --- |
| Exact board print | shared board/edition definitions + live DOM labels | Reuse IDs, names, prices, group hues and orientation. Warm cream printing, beveled dark backing, thin trim; inspection stays readable HTML. |
| Table and lounge | New original lounge PNG; existing CSS planes | Broad natural grain and warm light. No baked-in game. Original generated environment provenance in manifest. |
| City | Existing CSS plane buildings, roads, trees | Board owner: 8–12 reusable articulated silhouettes with 3–5 focal forms, setbacks/roof caps/facade detail. Rear-half city, foreground dice/decks/logo, rear property visibility. A recolor alone is not accepted. |
| Player tokens | Existing user-supplied classic-set crop fallback | Board owner: original procedural 3D geometry projected to shaded SVG, same identity on board/portraits/results. Preserve all existing IDs; retain fallback. Document mesh source code and original authoring in final manifest. |
| Property illustration | No suitable finished asset yet | Reuse articulated scene geometry as a static miniature illustration, no separate continuously rendering canvas per inspector. Export shared art for HUD integration. |
| Results hero | Real winner token | Reuse same procedural identity with a gold finish; no fixed dog or fabricated winner/statistics. |
| Dice/cards/developments | Existing accepted physical dice + CSS stacks + live pieces | Improve ivory/paper/contact materials only. Shared roll outcomes and green/red actual development counts stay unchanged. |
| Logo/icons/type | Existing live text/logo treatment + Lucide + DM Sans/Manrope | Clean geometric type. Montserrat preferred if sourced/loaded appropriately; otherwise record existing type substitution. No copied generated lettering. |
| Card/edition reference material | `public/assets/sources.json` and card manifest | Existing source/permission caveats remain. Do not describe all historical third-party reference material as newly licensed. |

No new rendering framework is required. Procedural 3D token geometry projected to SVG is an intentional renderer-compatible replacement, not a claim of WebGL/PBR or ray-traced quality. It must be judged from actual silhouettes, consistent metal lighting, bevel highlights and grounded contacts. Record remaining visual gaps honestly after review.

## Integration order and visual review evidence

1. Baseline: existing room/match/recovery behavior and current screenshots are preserved in `.runtime/inspection` and `.runtime/mobile-fullscreen-first-results`. Root captured the old distribution in an isolated eight-seat fixture at `.runtime/inspection/cinematic-baseline/{desktop-1920.png,desktop-1366.png,phone-390.png,baseline-metrics.json}`. Root reported 191/191 Node tests passing before the expanded visual implementation; this is a baseline, not final visual acceptance. The controlled baseline sample used installed headless Chrome 155, 16 logical cores, reported device memory 32GB, 1366×768, 16 native pan/wheel sequences: 304 frame samples, median 7ms, p95 13.9ms, zero samples over 50ms, 924 DOM nodes, 40 board tiles and zero page errors. These are observations from one headless protocol, not a hardware-wide FPS guarantee. Repeat the same protocol on the final candidate before comparing performance.
2. Composition cycle: inspect actual new menu/lobby + local/opponent match at 1920×1080, 1440×900, 1366×768, 390×844 and narrow phone. Verify board scale, desktop left/right rails, single turn module, useful camera-safe region, continuous phone play, all-corner overview, right-action authorization, drawer-aware framing. Fix the largest composition mismatch first.
3. Materials/lighting cycle: inspect newly articulated city, token identity/metal/gold, cream print, physical edges, room/table contact, decks/dice and property miniature. Verify no rear-row occlusion or wrong labels. Add asset filenames/provenance to manifest.
4. Final UI cycle: inspect all six finished screens, eight players/long names, light explicit appearance, keyboard/focus, reduced motion, chat keyboard, special decisions, reachable last actions, failure/offline feedback. Record measured evidence and remaining gaps.

No image has yet been declared final-match accepted. Capture lists and actionable findings are recorded below per actual cycle, not replaced by claims that a design brief itself proves completion.

### Visual cycle 1 — actual composition review

Reviewed all seven actual source-build captures in `.runtime/inspection/cinematic-cycle1/`: `menu-1366.png`, `match-local-1366.png`, `match-waiting-1366.png`, `phone-overview-390.png`, `property-1366.png`, `contract-1366.png`, and `settings-1366.png`. The capture report lists zero page errors. These came from an isolated three-seat fixture. Root independently agreed with the primary composition findings. The procedural token material pass was still in progress, so old cropped token art is not final material evidence. Results and eight-seat layout are not present in this capture set and are not accepted by implication.

What works: menu now has the correct large left brand and gold invitation hierarchy, live scene on the right, and real lounge atmosphere. Phone overview is a continuous full-screen walnut table with all four board corners visible, a readable current-space chip, large legal action and own cash. Desktop right-side context correctly distinguishes the local turn from the opponent's waiting state. Contract composer has clear two-sided participants and transfers. Settings has coherent functional groups and readable hierarchy.

Required composition corrections sent directly to implementers:

1. **Desktop default framing (Board):** both match captures enter Follow at 122% and clip most top/left spaces. Default/reset should show the complete board in the between-rails safe window, including miniature/edge height; Follow is an explicit useful zoom choice. The phone all-corner framing should remain. Do not enlarge a phone board merely to consume vertical space or force oversized overlapping labels; the chip, inspector and Follow provide the readable-detail path.
2. **Continuous tabletop (HUD + Board):** the desktop image currently occupies only the center rectangle, approximately x228–1135 at 1366 width, while full-height side areas remain solid dark green. Use one coherent app-level room/table atmosphere behind floating UI and transparent rail wrappers. Individual player/current-action cards stay dark glass. Remove the center photo's visible rectangular boundary; preserve the same camera safe area.
3. **Player identity (HUD):** the current local player's YOU badge is clipped to `YO…`. Reserve badge width and truncate only the player-name text. Keep full name available accessibly. The settings token is currently nearly black against charcoal; new token art must use the same identifiable portrait/lighting and an appropriate neutral coin background.
4. **Phone status duplication (HUD):** the top module already states Your turn; the ordinary bottom roll dock may show timer plus primary control without repeating the same headline. Preserve state explanations for jail/debt/auction or other meaningful special decisions.
5. **Property composition (HUD):** the image above a large full deed on the left pushes rent tiers below the initial fold, while price/ownership consume excess empty height at right. When space permits use approximately a 960px modal with a 40% miniature column and 60% compact real price/owner/rent details. Put complete management/group development in the reachable scrolling continuation. The first useful view should show the miniature, identity, real rent tiers and ownership. Avoid the oversized bright outer deed border within the otherwise restrained dialog.
6. **Long form reachability (HUD/QA):** contract composition is correct, but the full real form extends beyond the screenshot. Verify a reachable final review/submit action and consider a restrained sticky action footer. Do not remove conditions or supported semantics to force a shorter screen.

This is one completed visual-review cycle with corrective work identified. It is not final visual acceptance. Next capture cycle must show the fixed desktop composition and new architectural/metal materials; the final cycle must include all six finished states and compact/long-name/eight-seat cases.

### Visual cycle 2 — actual scene and material review

Reviewed `.runtime/inspection/cinematic-board-cycle2/match-local-1366.png`, `match-waiting-1366.png`, `phone-overview-390.png`, `property-1366.png`, and `settings-1366.png`. The set's capture report records zero page errors. Also generated and inspected `.runtime/inspection/cinematic-token-review/token-material-sheet.png` using `.runtime/astra-token-review.mjs`, which imports the real `projectTokenMesh` implementation and renders all eight model IDs at 48px portrait, 68px board and 112px gold-hero sizes. This is actual source-generated art, not a concept replacement.

Confirmed corrections: desktop now enters complete-board Overview at 100%; the continuous walnut surface runs behind floating left players and right action context; own/opponent controls retain distinct legal states. Ten articulated city silhouettes have changed the skyline from simple blocks through roof caps, stepped towers, facades and cornices while keeping rear property names visible. Cream board print, wood edge thickness, foreground dice/cards and central red plaque are coherent. Shared token geometry appears in both board and UI portraits; the formerly black settings token is now legible silver. Phone ordinary roll dock no longer repeats the top Your turn headline.

Remaining findings sent directly to the owners:

- **Phone backdrop regression:** the cycle 2 phone capture reverted from wood to a flat dark-green surface. The mobile game-stage background appears to cover the now app-level image. Preserve the full-screen structure and make that foreground stage transparent as on desktop; verify the next actual phone capture.
- **Overlay safe area:** although all desktop corners are geometrically in frame, the location chip covers part of Free Parking and the camera toolbar overlaps bottom-left property faces. Reposition these controls into a guaranteed clear region or include their visible bounds in fitting; complete projected bounds alone do not prove usable visibility.
- **Token silhouette quality:** hat, ship and thimble read clearly at actual portrait size. Dog/cat currently appear as thin extruded silhouettes with broad flat faces; car reads as a generic angular buggy; duck and penguin are weakly differentiated at 48px because face/bill detail is not exposed. Requested focused volume/silhouette refinements: fuller animal body/head/legs, curved cat haunch/tail, longer lower car bonnet with connected wheels, and an unmistakable duck bill versus upright penguin/flippers. Preserve IDs and shared geometry, and tune existing silver highlights rather than change rendering stacks.
- **Unfinished HUD corrections:** cycle 2 board-owner captures still show the truncated local YOU badge and pre-refinement property composition. HUD reports their fixes are in progress; those screenshots are not accepted as final evidence for either issue.

The actual asset path and model/illustration provenance are now listed in `public/assets/cinematic/manifest.json`. The token system is original procedural 3D geometry projected to shaded SVG, not full WebGL/PBR or photorealistic rendering. The city remains a deliberate stylized CSS 3D miniature. Existing DM Sans/Manrope typography is retained instead of Montserrat, with original system fallbacks and existing board label metrics; no new font binary or dependency is claimed.

This is the second completed visual-review cycle, with specific corrective work still open. Final polish review must use fresh captures after these corrections and must include real results, complete property/contract reachability, narrow portrait, eight players/long names, and reduced motion. It must not infer unseen states from a successful local-turn screenshot.

## Existing validation commands and release boundary

`npm run build` runs Vite. `npm test` runs Node tests. `npm run test:e2e` runs Playwright. Use isolated local test rooms and data. Avoid the live deployment, room files, and real user sessions. Keep test captures separate from public assets. Do not claim 60fps, a lower-power tier, WebGL robustness, memory stability or contrast compliance without the relevant measurements; this stack has no WebGL context to audit.

Final handoff needs changed source files, manifest, before/after captures, tests actually run, dependency changes (if any), and honest art/validation gaps. Stage the complete concrete result for approval; do not automatically publish over the live deployment.
