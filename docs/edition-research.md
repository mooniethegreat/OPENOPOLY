# Edition research and implementation provenance

Researched October 14, 2026. The host selects an edition in the lobby. Its board, prices, rules and card configuration are fixed when play starts.

## Classic Openopoly · US rules

Primary rules reference: [Hasbro's Monopoly Vintage instruction sheet](https://www.hasbro.com/common/instruct/Monopoly_Vintage.pdf). The implementation covers normal turns, doubles, GO, purchases, auctions, rent, jail, building supply, even development, mortgages, private trades, liquidation and bankruptcy. The classic board has 40 spaces and 28 purchasable deeds. Houses and hotels have separate finite inventories. Printed deed economics were checked against the user's supplied deed reference images; the Boardwalk building cost is $200, correcting the apparent $20 error in one supplied composite.

The digital edition uses the traditional US 2008-era card effects, brown first color group, a flat $200 income tax and $100 luxury tax. It therefore intentionally does not adopt the older Vintage sheet's optional 10% income tax or an older $75 luxury tax. This is one selected classic ruleset, not a claim that all physical printings have identical rules or cards. Card descriptions are concise functional paraphrases.

Digital conventions: rent is collected automatically; tied opening rolls reroll automatically; mortgage interest is rounded upward to a whole dollar; auction participants explicitly pass rather than using a timer. House/hotel auctions are available through a property action for competing eligible owners. A highest bidder's committed cash cannot be spent elsewhere before the auction closes. The game does not include the optional Speed Die, short-game variant, Free Parking jackpot, or mansions in Classic; its final development is one hotel per street.

## Inland Empire-opoly: verified photographs

Sources:

- [Physical-game listing](https://www.ebay.com.sg/itm/165409763674).
- [1600-pixel box/board photograph](https://i.ebayimg.com/images/g/g8oAAOSwQB5iRJlA/s-l1600.jpg).
- [Close-up showing deeds and Contingency cards](https://i.ebayimg.com/images/g/Rg0AAOSw7dtiRJkT/s-l1200.jpg).
- [Box description photograph](https://i.ebayimg.com/images/g/6IIAAOSwSyhiRJkR/s-l1200.jpg).
- [BoardGameGeek catalog identity](https://boardgamegeek.com/boardgame/299440/inland-empire-opoly); catalog corroboration only, not a source for individual rent values.

The board photograph establishes the property names, layout, purchase prices, tax amounts and color families. In this edition Wine Country occupies space 36 and Contingency occupies space 37. The two tax charges visible on the board are $200 and $75. All four station-type properties cost $250; both utility-type properties cost $175. Development pieces are named City Blocks and Keys to the City.

The close-up verifies these two complete deed schedules:

| Deed | Purchase price | Base / 1 / 2 / 3 / 4 / final rent | Building cost | Mortgage |
| --- | ---: | --- | ---: | ---: |
| Glen Helen Amphitheatre | $210 | $18 / $90 / $250 / $700 / $875 / $1,050 | $150 | $110 |
| The 909 | $400 | $50 / $200 / $600 / $1,400 / $1,700 / $2,000 | $200 | $200 |

Glen Helen's printed mortgage is $110 even though its board purchase price is $210. The engine preserves the photographed value rather than assuming every mortgage is half the current board price.

Two photographed Contingency effects are implemented with verified-effect metadata: receiving $20 after a third-place classic-car result at Back to Route 66 Rendezvous, and losing one turn after too many old-fashioned donuts at Winchell's. The latter is implemented as skipping the player's next turn.

## Requested custom property: The Resort

At the user's explicit request, **The Resort** apartment complex replaces **The Mule Car** at board position 1. The board remains 40 spaces. Its purchase price remains $70, with the same color group, rent table, mortgage and development costs already assigned to that slot. This is a user customization, not a property recovered from the physical Inland Empire-opoly box. The property's `originalName`, `customization`, and `verification.name = 'user-customization'` fields preserve that distinction; the edition's `customizations` list identifies the replacement for every player. The slot's unverified deed economics remain marked as classic fallbacks. Classic Openopoly is unaffected.

## Inland Empire-opoly: publisher-family rules and limits

The complete Inland Empire instruction sheet and all individual cards were not recovered. The rules baseline comes from the same publisher's [America-opoly instruction sheet hosted by the Smithsonian Store](https://www.smithsonianstore.com/product_images/uploaded_images/Americaopoly_Instructions.pdf), with [Brampton-opoly instructions](https://www.bramptonlibrary.ca/board-games/brampton-opoly-rules.pdf) and [the publisher-authored Farm-opoly sheet](https://manualzz.com/doc/44372560/farm-opoly-instructions) as corroborating editions. These are primary publisher instructions for related games, not proof of every Inland Empire rule.

This baseline gives each player $1,630; starts tokens in the center with GO counting as the first movement space; provides a center pot collected on the local free-space counterpart; and charges $100 after three unsuccessful Traffic Jam escape rolls. The winning opening roll immediately supplies the first move, so a new Inland game can open with a purchase decision already pending. It does not offer Classic's voluntary early $50 jail payment. Inherited mortgaged properties require full redemption. Initial movement receives a GO salary because the publisher's stated GO payment has no first-move exception; this is an interpretation, not an independently verified Inland Empire rule.

The complete unphotographed rent schedules, mortgages, development costs, station/utility rent formulas, building inventory counts, and 30 remaining card effects are **not verified for Inland Empire**. They currently use classic-derived placeholders so the researched edition is playable. Every affected deed has `verification.economics = 'classic-fallback-unverified'`; every affected card has `verification = 'classic-fallback-unverified'`. The two photographed deeds and two photographed card effects carry distinct verified-source values. Edition metadata explains this limitation to players, and individual drawn cards retain their verification label.

The center-pot implementation routes fines, taxes, repair charges and mortgage payments into the pot, while property/building purchases and rent are excluded. This interprets the publisher-family rule's broad wording about non-rent/non-purchase payments. Modern digital contract payments are direct player transfers and never fund this pot.

This mode is a researched adaptation, **not an exact recovered copy**. Additional authenticated photographs or the actual instruction sheet can replace fallback entries in `shared/board.js` without changing networking or UI contracts. Do not remove the visible research disclosure until those details have been verified.

## Contract and voting extensions

Player contracts, automatic future-payment conditions and room votes are custom digital features, separate from both physical rulebooks. Contracts can exchange cash, undeveloped deeds and jail cards. A mortgaged transfer records whether the recipient retains or immediately redeems the mortgage. Insufficient automatic contract payments become visible defaults rather than replacing the board game's mandatory debt flow. Free-form conditions require both signatories to confirm that the condition happened. Votes record majority or unanimous room decisions; they do not silently rewrite fixed edition rules.

## Validation

`tests/engine.test.js` tests classic economics, all 32 classic card effects, GO, doubles, jail, rent, property/building auctions, even construction, inventory, mortgages, trades, debt rescue, bankruptcy, inherited mortgages, edition-specific economics, verified Inland effects and private-state projection. Seeded games exercise both editions while checking nonnegative cash, valid ownership and conserved building stock. Server tests separately exercise room/session authorization, transactional contracts, vote rules and multiplayer synchronization.
