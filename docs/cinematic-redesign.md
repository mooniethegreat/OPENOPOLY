# Cinematic presentation migration

The application is React19/Vite6 with a live CSS3D board. It does not use WebGL or Three.js. Socket.IO commands and the authoritative engine remain the source of all balances, ownership, permissions and outcomes. No new renderer or package dependency is introduced.

## Component and state map

| Screen or feature | Actual source | State/authority |
| --- | --- | --- |
| Session, socket, command receipt/recovery | `src/App.jsx`, `src/action-gate.js` | Public versioned room; frozen command identity/context; existing receipts |
| Board, camera, tokens, dice | `src/Board.jsx`, `board-scene.css`, `board-camera.js`, `presentation.jsx` | Board definitions and server presentation timeline; camera is local |
| Scene shell and six-screen materials | `src/mobile-game.css`, `table-chrome.css`, `cinematic-views.css` | Neutral Graphite dark default; four optional color palettes and light mode; local camera expansion |
| Players, one turn module, utilities, sheets | `src/GameHUD.jsx` | Public players, current/next traversal, actual permitted actions |
| Contextual game decisions | `src/GameControls.jsx` | Authoritative room game; existing action gateway |
| Main menu / create / join | `src/Welcome.jsx` | Existing create/join APIs and saved guest seats |
| Property inspection | `PropertyModal`, `CinematicViews.jsx` | Actual deed data, owner, mortgages, legal development and purchase controls |
| Bilateral agreements | `src/Panels.jsx` | Existing server-validated assets, finance metadata, obligations, revisions and signatures |
| Results | `MatchResults` in `CinematicViews.jsx` | Real finished status/winnerId, final cash, deed count and table turn |
| Game / Audio / Appearance settings | `SettingsSections`, existing profile/rule controls | Host/lobby rules remain shared; sound is local; appearance uses existing host broadcast |
| Money, sound and reactions | `PaymentFeedback`, `MoneyFlight`, `GameAudio`, emote modules | Completed public events; bounded cosmetic effects, never game commands |

The command flow remains: a control renders from one decision snapshot, the gateway validates that captured context against the latest received room, freezes one command ID and packet, and emits it once. The server validates permissions/decision version and commits atomically. A rejected or uncertain command is never silently rerun with a new ID.

## Asset inventory and remaining art limits

| Asset | Source / path | Use |
| --- | --- | --- |
| Board names, prices, rents, cards | `shared/board.js`, existing edition data | Live game data; never copied from the concept image |
| Original board/card/deed references | `public/assets/reference`, `public/assets/card-art`, existing sources manifest | Supplied scans and card illustration; deed scan remains available |
| Evening lounge | `public/assets/cinematic/evening-lounge-original.png` | One original generated empty environment, authored for this project; no baked UI or board |
| Property vignette | Native SVG in `src/CinematicViews.jsx` | Procedural architectural illustration; no new image service or renderer |
| Token presentation | Existing `Token` export from Board | Correct actual token identity; gold material only for the winner hero |
| Fonts | Existing DM Sans / Manrope, system fallback | No supplied Montserrat font binary; existing family retained rather than adding a dependency |

The city/board remain a CSS3D scene with procedural architecture. This is not a claim of photorealistic meshes, physically based ray tracing, or measured WebGL performance. Asset provenance for the original lounge is recorded in its cinematic asset manifest. No assets were purchased or project files uploaded to an external service.

## Review and verification record

1. **Baseline / composition:** old production evidence is under `.runtime/inspection/cinematic-baseline/`; first cinematic compositions are under `.runtime/inspection/cinematic-cycle1/`. Desktop uses left players, an unbordered central scene, one right action rail and a slim utility dock. Phone stays a full-viewport scene with temporary full-screen sheets.
2. **Material / spatial pass:** `.runtime/inspection/cinematic-cycle2/` records the continuous table environment, full-board overview, two-column property/rent view and actual winner results. The final user direction supersedes the earlier green-tinted chrome: fresh rooms now use equal-channel black/gray Graphite surfaces. Four saved color choices and explicit light mode remain supported.
3. **Final UI pass:** `.runtime/inspection/cinematic-cycle3/` contains 19 actual-App captures covering menu, lobby, local/observer match, property, bilateral contract, settings/audio, results, eight seats with long names, both editions, Ocean light,1920x1080,1440x900,1366x768,390x844,320x568 and844x390. `report.json` records zero page errors, shared five-palette checks, preserved gameplay decision version and no horizontal overflow at1920/1440/911px. The911x512 capture checks the CSS viewport corresponding to approximately150% browser zoom on a1366x768 display; it does not claim browser-toolbar zoom automation.

Reproduce the six-screen evidence with `node scripts/capture-ui.mjs [output-directory]`. It bundles current source in memory, starts an isolated ephemeral server, creates disposable fixture rooms and closes all contexts/server resources. It never builds `dist` or reads/modifies persisted user rooms.

The final focused browser run passed13/13 cases in `.runtime/cinematic-final-core-results/`: independent full-screen sheets at390/320x568/landscape, actual buy/jail/camera hit tests, shared server countdowns, doubles/card instructions, atomic group building, stale reviewed prices, long-contract scrolling, and topmost modal Tab/Shift-Tab/Escape/focus return over the contracts drawer. A final landscape-only safe-window regression follows the small board-fitting correction; the root release review owns the combined staged build/full suite.

Computed final default samples: player names14px, cash26px, Roll18px; text rgb(243,243,243), non-current card gradient rgb(27,27,27)→rgb(16,16,16), input surface#242424. Gold focus/current state, red legal actions, green agreement confirmation and semantic player/property colors remain deliberate accents.

Production publication requires separate explicit authorization; this presentation work does not deploy or reset an existing room. Portable repository publication and hosting packaging are handled separately from local visual QA.
