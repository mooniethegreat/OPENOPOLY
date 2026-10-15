# Real-time gameplay API

All actions use the existing authenticated Socket.IO `action` event and its `{ok, room?, error?}` acknowledgement. Identity comes from the guest session, never an action field. Accepted changes are persisted before a room broadcast.

## Command identity and decision binding

Public rooms advertise `actionProtocol: 2` and a durable `decisionVersion` (zero for a saved room that predates this protocol). Every action includes a fresh `commandId`, normally `crypto.randomUUID()`, chosen once for one explicit user intent. Engine actions, `money:send`, contract propose/revise/sign/confirm/pay, and `room:start` also freeze the decision the player reviewed:

```js
{
  type: 'buy', propertyId: room.game.pendingPurchase,
  commandId: crypto.randomUUID(),
  expectedDecisionVersion: room.decisionVersion,
  expectedTurn: room.game?.turn ?? null,
  expectedCurrentPlayerId: room.game?.currentPlayerId ?? null,
  expectedPhase: room.game?.phase ?? null
}
```

Both `buy` and `auction` require the explicit offered `propertyId`. The server compares the complete decision context before acting. A delayed buy cannot purchase a different later landing, and a delayed roll or end-turn cannot act when the seat comes around again. `decisionVersion` changes with game/cash outcomes and scheduled payment/default transitions. Chat, votes, appearance, presence, and presentation completion do not invalidate an otherwise current game decision. Other room actions and contract cancellation/rejection require an ID but do not require this decision context. Before a game starts, the three game fields are `null` and the initial decision version is zero.

The server durably retains the latest 256 private command receipts per room, scoped to the authenticated seat. Repeating the identical command returns `{ok: true, duplicate: true, commandId, appliedVersion, appliedDecisionVersion, room}` without another transaction, payment, log entry, or broadcast. Changing any instructions under an accepted ID returns `COMMAND_ID_CONFLICT`. Replays are checked before stale-state checks, so an accepted retry can recover its result after the game has advanced. After an old receipt ages out, its older decision version still prevents another financial action.

Stale decisions return `{ok: false, errorCode: 'STALE_DECISION', error, commandId, room}`. Missing identity/context returns `COMMAND_METADATA_REQUIRED` with a refresh message. Ingest the returned current room, leave the game intact, and require a fresh explicit decision. Do not automatically retry or invent a new ID after a timeout.

If an acknowledgement is uncertain, authenticated `GET /api/rooms/:code/commands/:commandId` returns `{status: 'applied'|'unknown', commandId, appliedVersion?, appliedDecisionVersion?, room}`. A player can inspect only their own receipt. `applied` confirms the original action succeeded and can close its payment form. `unknown` is inconclusive because the packet could still be delayed or a receipt could have aged out; preserve the exact frozen command and ID for a deliberate retry and do not silently send another payment under a new ID. Receipt hashes and private receipt history are never projected to clients.

## Presentation timeline

Every public room has `serverNow` (UTC milliseconds when projected) and `presentation` (an active timeline or `null`). `serverNow` is never persisted. A timeline is persisted so reconnecting clients can join its current progress:

```js
{
  id: 'server-generated UUID',
  playerId: 'rolling or moving player ID',
  startedAt: 0, rollEndsAt: 1500, endsAt: 2600, // absolute UTC ms
  dice: [2, 5], // null when pending movement resumes without another roll
  moves: [{
    playerId: 'moving player ID', from: 0, to: 7,
    path: [1, 2, 3, 4, 5, 6, 7], // excludes from, includes to
    startedAt: 1500, endsAt: 2480, direct: false
  }],
  events: [] // public game.log events produced by this action
}
```

Clients estimate the server clock from `serverNow - Date.now()` and sample progress against absolute times. A snapshot already contains the final authoritative game outcome. Animate positions from `moves`, then reveal resulting decisions after `endsAt`. Do not start a new animation on every snapshot. Use `id` and join the current progress after reconnecting. Expired timelines project as `null`, and a completion broadcast refreshes the controls. Rooms have a persisted monotonic `version` (legacy rooms start at zero). For the same room code, discard snapshots with an older version or an equal version and older `serverNow`, so a delayed action acknowledgement cannot overwrite a newer broadcast. Presence broadcasts keep the version and refresh `serverNow`.

The ordinary dice phase lasts 1500 ms, followed by 140 ms per traversed space. Long card advances are capped, and direct jail moves last 450 ms. A card can introduce another move after the first landing. Backwards cards have backwards paths. Inland Empire's center position is `-1`; its initial path starts with `0` and ends at the winning opening roll's destination. A jail attempt with no movement still has a dice timeline. A utility reroll remains a public `utilityRoll` event and does not replace the primary dice result.

During an active timeline, the server rejects gameplay, money, signing, and other contract mutations. Chat, votes, host appearance changes, and cancellation/rejection of unsigned proposals remain available. Reduced motion can snap visuals to the result while retaining the server's lock duration. Clients cannot choose durations. Node test fixtures can explicitly request a short or zero timing configuration.

## Chat

Send `{type: 'chat:send', text}`. Text is trimmed, control characters removed, and must contain 1–500 characters. Room seats may chat in the lobby, game, or finished room, including bankrupt players. Each seat may send eight messages per ten seconds across all its sockets. A successful send appends `{id, playerId, text, at}` to `room.chat`, oldest first, keeping the latest 150 messages. `at` is a server ISO timestamp. Chat is plain text and should be rendered as text.

## Direct money transfer

Send `{type: 'money:send', toPlayerId, amount, note?}`. `amount` is a positive whole dollar amount up to 1,000,000, `note` is optional plain text up to 140 characters, and both participants must be active players in a playing game. A donor cannot spend auction-reserved cash or send money while personally resolving mandatory game debt. Another player may send money to the debtor; the engine settles affordable mandatory debt and resumes queued effects in the same transaction. Failed validation leaves all cash and logs unchanged. The public audit event is `moneyTransfer` with authenticated `fromPlayerId`, `toPlayerId`, `amount`, and `note`.

## Scheduled and financed agreements

Existing future triggers remain `afterTurns`, `passGo`, `landOn`, and `manual`. Written manual conditions require both parties to confirm; prose is never interpreted automatically.

One-off clock payments use `{type: 'atTime', at: '2026-10-15T18:00:00-07:00'}`. The timestamp must include a timezone, be in the future, and be no more than 30 days ahead when proposed/revised. It must still be in the future at final signing. The server normalizes it to UTC and persists it. `repeat: true` is invalid for this trigger. Timers recover pending deadlines on startup, settle once through durable transactions, and defer a deadline during presentation until the animation ends. Due payments with insufficient available funds or mandatory game debt become `defaulted`, leave balances unchanged, and can be settled by the debtor with `contract:pay`. A default never retries automatically. Bankrupt parties terminate pending obligations.

Optional financing metadata lives in `terms.finance`:

```js
{
  kind: 'loan', // or 'deferred' for a financed property purchase
  payerId: 'borrower or buyer', payeeId: 'lender or seller',
  principal: 200, interestBps: 500, obligationIndex: 0
}
```

The server returns computed `interest`, `totalOwed`, and `propertyIds`. Interest is a fixed amount agreed at signing: `ceil(principal * interestBps / 10000)`; 100 basis points is 1%, and zero disables interest. The bound obligation must be a single payment from payer to payee for exactly `totalOwed`. Cash loans require a net immediate principal transfer from payee to payer. Deferred property purchases require immediate deed transfers from payee to payer; principal is the parties' agreed unpaid price. Any downpayment is a separate immediate cash transfer. Deeds transfer once both parties sign; missed payments follow the ordinary default ledger without automatic repossession or changing the agreed interest.
