# OPENOPOLY

A multiplayer property trading game with a shared 3D board, synchronized dice and movement, contracts, chat, votes, reactions, and sound effects. React and Vite provide the UI; Express and Socket.IO run the authoritative game server. Rooms and guest seats persist across server restarts.

## Run locally

Install Node.js **22.13 or later**, then:

```sh
npm ci
npm run dev
```

Open **http://localhost:5173**. Create a room and share its invitation link. Use another browser or private window for another player. A game needs at least two players; Classic supports eight and Inland Empire-opoly supports six.

For LAN play, open the host computer's LAN address instead of localhost before copying the invitation. The development UI uses port 5173 and proxies the game server on port 3001.

## Production build

```sh
npm ci
npm run build
npm run check:production
npm start
```

Open **http://localhost:3001**. One server serves the built UI, HTTP API, and WebSocket connections. `check:production` starts an isolated in-memory server and verifies the built UI without touching saved games.

GitHub hosts this source repository. Playing over the internet requires running the server on a host that supports Node.js or Docker; static hosting alone cannot run the multiplayer backend.

## Docker

With Docker Compose installed:

```sh
docker compose up --build -d
```

Open **http://localhost:3001**. Saved games live in the named `openopoly-data` volume. Normal container restarts and image rebuilds preserve it. `docker compose down -v` deletes saved games.

To change ports or allow LAN connections, copy `.env.example` to `.env` and adjust `OPENOPOLY_PORT` or `OPENOPOLY_BIND`.

### HTTPS hosting

The optional Caddy setup provides HTTPS and forwards WebSockets. On your own Docker host:

1. Point a domain at the host and make ports 80 and 443 reachable.
2. Create `.env` with `OPENOPOLY_DOMAIN=game.example.com`, using your domain.
3. Run:

```sh
docker compose -f compose.yaml -f compose.https.yaml up --build -d
```

Open `https://game.example.com` and create rooms from that address. Caddy stores its certificates in separate named volumes. This configuration does not provision a server, purchase a domain, or publish anything automatically.

Run **one application instance** with its persistent data volume. The JSON store is not designed for multiple replicas sharing one file. Back up the data volume and keep the same public origin so browsers retain access to their saved seats.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3001` | Application HTTP/WebSocket port |
| `HOST` | `0.0.0.0` | Listening interface |
| `STORE_PATH` | `./data/rooms.json` | Persistent room and guest-session store |
| `PUBLIC_ORIGIN` | unset | Optional exact allowed browser origin |
| `OPENOPOLY_BIND` | `127.0.0.1` | Docker host binding; use `0.0.0.0` for LAN access |
| `OPENOPOLY_PORT` | `3001` | Docker host port |
| `OPENOPOLY_DOMAIN` | unset | Domain for the optional HTTPS setup |

Docker Compose reads `.env`. Direct Node commands use process environment variables; after building, Node can read a file with `node --env-file=.env server/index.js`.

Guest credentials stay in each browser. Keep browser storage and the server data volume to preserve seats. A display name alone does not recover a lost guest session. The server stores token hashes rather than raw guest tokens.

## Gameplay

- Authoritative turns, doubles, jail, purchases, auctions, rent, mortgages, even building, finite building supply, debt, and bankruptcy.
- Shared roll and movement timelines, reconnect recovery, and 30-second automatic roll/end deadlines that pause for required decisions.
- Optional lobby rule to pass on an unowned property without an auction; rules lock when play starts.
- Atomic color-group development, visible release-card inventory, personal payment feedback, and shared money effects.
- Signed contracts for cash, properties, release cards, loans, fixed interest, deferred purchases, and future payments. Both parties sign the same revision.
- Scheduled payments after turns, passing GO, landing on a space, a clock deadline, or a condition both parties confirm. Insufficient funds produce a visible default.
- Bounded room chat, direct payments, majority/unanimous votes, and temporary shared reactions.
- Local mute/volume controls and synthesized sound effects; audio activates after a browser gesture. Graphite dark is the default appearance, with optional shared palettes and light mode.

Inland Empire-opoly is a researched reconstruction with disclosed fallback economics/cards where the original material was unavailable. The custom **The Resort** occupies space 1 at $70. See [edition research](docs/edition-research.md) and [real-time gameplay](docs/real-time-gameplay.md).

## Checks

```sh
npm test
npm run build
npm run check:production
```

Browser checks use Playwright and Google Chrome:

```sh
npx playwright install chrome
npm run test:e2e
```

The default browser suite builds and starts an isolated server on port 3199. `E2E_BASE_URL` can point it at an existing **test** server; these tests create rooms and send game actions. Artifacts and test stores are written under ignored `.runtime/` paths. `scripts/capture-ui.mjs` produces screenshots from an isolated in-memory fixture.

## Source and assets

`shared/` contains the board and game engine, `server/` owns authentication and durable transactions, and `src/` contains the browser presentation. Every accepted game action validates before committing, carries an identity for duplicate protection, and publishes only public state. Private decks and random state are not sent to browsers.

Asset provenance is recorded in [the source ledger](public/assets/sources.json), [card-art sources](docs/card-art-sources.md), and [the cinematic asset manifest](public/assets/cinematic/manifest.json). Existing game names, marks, and reference artwork retain their respective owners and provenance; this repository does not claim they are newly licensed. No project license is declared.

Local saved games, credentials, tunnel/process records, deployment helpers, build output, dependencies, and test captures are excluded from this repository.
