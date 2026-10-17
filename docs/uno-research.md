# OpenUno: edition research, rules, and artwork

Verified 17 October 2026. OpenUno is part of the same application as Openopoly. The implemented editions are the traditional 108-card Classic deck and Mattel's 112-card Disney Lilo & Stitch deck, product **JCC10**. This document records the evidence and the limits of the reconstruction; it does not claim that every image is a scan of an original printed card.

## Evidence and edition identity

| Source | Use and authority |
| --- | --- |
| [Mattel Classic instructions, 53641 PDF](https://service.mattel.com/instruction_sheets/53641.pdf) | Primary rules for the traditional 108-card deck, scoring, opening actions, two-player play, and challenges. Its separately labeled house rules are optional variants, not the standard game. |
| [Mattel JCC10 English instructions](https://service.mattel.com/instruction_sheets/JCC10%20English.pdf) | Primary rules for Stitch, including the distinctive Ohana action and its Wild Draw Four wording. |
| [Mattel JCC10 support record](https://service.mattel.com/us/productPopup.aspx?prodno=JCC10&siteid=27) | Identifies the edition as Disney's Lilo and Stitch, released in 2024, and describes the four-card Ohana result. |
| [Mattel product gallery](https://shopping.mattel.com/es-es/products/uno-disney-lilo-y-stitch-juego-de-cartas-jcc10-es-es) | Primary visual evidence: packaging, complete example fronts, back, number families, character assignment, and 112-card contents. The English instruction sheet governs gameplay where translated retail prose is imprecise. |
| [Geeky Hobbies: card meanings](https://www.geekyhobbies.com/uno-disneys-lilo-and-stitch-card-meanings/) and [rules](https://www.geekyhobbies.com/uno-disneys-lilo-and-stitch-rules/) | Secondary evidence: Eric Mortensen's photographs of the physical cards and component inventory. Used to identify the illustrations and fill artwork gaps, not to override Mattel's rules. |
| [Wikimedia: UNO cards deck.svg](https://commons.wikimedia.org/wiki/File:UNO_cards_deck.svg) | Complete Classic vector reproduction by Dmitry Fomin, dedicated under CC0 1.0. This is a community vector rendition, not a Mattel scan. |
| [Wikimedia: UNO Logo.svg](https://commons.wikimedia.org/wiki/File:UNO_Logo.svg) | Mattel logo, listed as PD-textlogo on Commons; trademark rights remain. Used in a digital Classic back layout. |

## Decks and standard play

Classic has one 0 and two of each 1–9 in every color; two Skip, Reverse, and Draw Two per color; and four each of Wild and Wild Draw Four. That is 108 cards. The application deliberately excludes the extra custom/blank cards sold in some newer packs. Deal seven. Match color, number, or action symbol; drawing is allowed even with a playable hand. Only the newly drawn card can be played after drawing. Draw Two makes the next player draw two and lose a turn. With two players, Reverse acts as Skip. Opening action cards follow the Classic sheet's individual instructions. Standard penalties do not stack. Number cards score face value, colored actions 20, and wilds 50; a match ends at 500. [Mattel Classic sheet](https://service.mattel.com/instruction_sheets/53641.pdf).

Stitch adds four Wild Ohana cards, for 112. Its printed families are **pink, purple, green, and blue**; internal shared keys map `red → pink` and `yellow → purple`. Initial action cards are passed over until a number starts play. Ohana applies to everyone, including its player: hands above four choose excess cards to put below Ohana; hands below four draw up to four; then its player chooses the resumed color. Ohana scores 50. Stitch's Wild Draw Four challenge explicitly treats another wild in the offender's hand as a matching-color card. A successful challenge makes the offender draw four; a failed challenge makes the challenger draw six and lose the turn. Stitch describes single-hand victory and optional cumulative scoring to 500. [Mattel JCC10 sheet](https://service.mattel.com/instruction_sheets/JCC10%20English.pdf).

The UI offers a 500-point match by default and a single-round option for either edition. There is no stacking, jump-in, or seven-zero setting. Calling UNO and catching a missed call use the server's ordered actions so two browsers cannot award the same penalty twice. The next committed turn action closes the catch window.

## Explicit digital interpretations

- The dealer is selected randomly instead of having every player draw a physical card to determine the dealer.
- An Ohana is fully resolved before checking for an empty-hand winner. Playing it as the last card therefore brings its player back to four. JCC10 does not expressly settle the conflict between its last-card victory sentence and Ohana's everyone-to-four effect. This is the application's chosen interpretation, not a claimed official clarification.
- Ohana choices are collected in a deterministic server order. The discarded cards remain under Ohana, without firing their actions. Drawing deficient hands and choosing the resumed color complete the action.
- Every draw uses the same play-or-keep decision phase. Only the drawing player receives which newly drawn card is playable. Keeping the public phase uniform avoids revealing private playability through the timing of an automatic pass. A turn timeout draws and keeps the card.
- The server keeps draw order, other hands, and random state private; the manifest is cosmetic. Selecting an artwork entry never determines whether a play is legal.

## Exact artwork and adaptations

The authoritative asset index is [manifest.json](../public/assets/uno/manifest.json). Each face is keyed by the engine's `definitionId`, with a source URL path, source dimensions, pixel crop, provenance ID, and status. Copies of a card share its face. The manifest covers **54 Classic definitions and 55 Stitch definitions**, plus one back per edition.

Classic fronts are unchanged viewports into Fomin's 3362 × 2882 SVG. The first four 360-pixel rows provide 0–9, Skip, Reverse, and Draw Two in 240-pixel columns. Wild is column 13, row 0; Wild Draw Four is column 13, row 4. Crops begin at the one-pixel atlas inset. The Classic back is a digital arrangement of the sourced UNO logo and simple geometry; it is labeled `adapted-logo-layout`.

**Only 13 Stitch front definitions and its back use complete official product crops.** The rest are adaptations. No complete flat scan set was found in the inspected official gallery and physical-card reference sources.

| Stitch definition | Complete official source |
| --- | --- |
| `wild`, `wild-draw-four`, `ohana` | Top row of `product-3.png` |
| `blue-draw-two`, `green-reverse` | Middle row of `product-3.png` |
| `green-9`, `yellow-skip` (purple), `yellow-7` (purple) | Bottom row of `product-3.png` |
| `red-0` (pink), `green-0`, `blue-0`, `yellow-0` (purple) | Rightmost complete number card in each row of `product-4.png` |
| `green-skip` | Complete final action card in the bottom fan of `product-4.png` |
| Back | Middle card in `product-3.png` |

All exact crop rectangles are recorded in [source-map.json](../public/assets/uno/stitch/source-map.json), in original 2000 × 2000 coordinates.

The other **42 Stitch fronts** use `adapted-source-art`: original photographed number illustrations or complete official action illustrations, clipped into a digital frame with the correct suit and identifier. They are collected in `stitch/adapted-atlas.svg`. The original photo's interior background can retain a different printed color, photographic perspective, and repeated number marks. The outer frame and corner identifier show the actual playable suit/value. These faces are usable adaptations, **not pixel-faithful reproductions or additional official scans**. Disney characters were sourced from the reference images; none were synthesized with an image model.

Visual character mapping is consistent across number families: 0 Lilo bathing Stitch; 1 Stitch; 2 Lilo dancing; 3 Nani surfing; 4 David surfing; 5 Jumba; 6 Pleakley; 7 Cobra Bubbles; 8 Lilo and Stitch on a bicycle; 9 the Grand Councilwoman. Skip shows Lilo and Stitch resting; Reverse shows Gantu; Draw Two shows Jumba and Pleakley. The official wild and Ohana artwork remain complete source crops.

## Files, credits, and reproducibility

The shipped source images are deliberately limited to the two used official gallery images and the used physical-card number photograph. Duplicate regional downloads and unused research photographs were removed. `build-art.mjs` recreates the derived atlas, digital Classic back, source map, and manifest from these local source files; it does not download assets or generate character artwork.

| Local source | Original image and credit |
| --- | --- |
| `stitch/product-3.png` | [Mattel gallery original](https://shopping.mattel.com/cdn/shop/files/p4pe1wdycbiqhlzh3nal_bbf17f09-5cbd-4855-bc4f-ba5230123d7c.png?v=1738010366), ©Mattel / ©Disney |
| `stitch/product-4.png` | [Mattel gallery original](https://shopping.mattel.com/cdn/shop/files/slucww60cefzohtvaycp.png?v=1738010366), ©Mattel / ©Disney |
| `stitch/review-number-cards.jpg` | [Eric Mortensen / Geeky Hobbies photograph](https://www.geekyhobbies.com/wp-content/uploads/2024/09/UNO-Disneys-Lilo-and-Stitch-Number-Cards.jpg) |
| `classic/deck-source.svg` | [Dmitry Fomin / Wikimedia Commons](https://commons.wikimedia.org/wiki/File:UNO_cards_deck.svg), CC0 1.0 |
| `classic/uno-logo-source.svg` | [Mattel / Wikimedia Commons](https://commons.wikimedia.org/wiki/File:UNO_Logo.svg), Commons PD-textlogo classification |

The manifest includes direct official image URLs and SHA-256 hashes. The Mattel/Disney images and review photography have no open license asserted here. Their presence as reference artwork does not grant a redistribution license. UNO, Mattel, Disney, Lilo & Stitch, their logos, and character artwork retain their owners' rights; this project is not presented as an official Mattel or Disney product. Fomin's CC0 dedication applies to his vector work, not to third-party trademarks or the Stitch files.

Validation checks every generated deck definition against its edition's manifest, checks local paths and crop bounds, and counts each status. Contact sheets were rendered in Chromium/Edge and visually inspected for number/action identity, crop alignment, and readable corners. This validates coverage and rendering; it does not turn an adaptation into an exact original face.
