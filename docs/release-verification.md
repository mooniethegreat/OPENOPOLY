# Release verification — October 15, 2026

- **197 Node tests passed**, covering authoritative rules, transactions, duplicate protection, timers, presentation, payments, audio and reactions.
- **52 unique Playwright browser cases verified** across the final sweep and focused reruns. Updated semantic selectors and the release-card fixture's complete application styles preserved all financial and rule assertions.
- The isolated production check passed for the final build. The public Cloudflare index, JavaScript and stylesheet matched the staged release byte for byte.
- A fresh public QA table passed a **three-browser smoke test**: shared 30-second automatic roll, identical dice/movement timeline, chat, signed contract, payment duplicate protection, stale-action rejection, reactions to the table/player/property, camera gestures and mobile inventory. No browser errors occurred. Reactions did not change game state.
- Before/after deployment checks preserved every prior room, seat authorization, cash balance and deed ownership. Deployment did not replace the durable room store.

The checked installation used React **19.3.1**, Vite **6.4.4**, Express **5.3.0** and Socket.IO **4.8.4**. `package.json` declares compatible version ranges; `package-lock.json` pins the tested dependency tree.

Tokens use original procedural 3D geometry projected to shaded SVG, and the miniature city uses CSS 3D planes. These are stylized assets, not photorealistic scanned models or a WebGL/PBR renderer. Asset origins and limitations remain documented in the source manifests.

Docker and Compose packaging is included, but no Docker runtime was available for a container smoke test. Direct Node production serving and public multiplayer were verified. Run one application instance with its persistent data volume.
