# Card illustration source ledger

Retrieved October 14, 2026 from [donutheist/monopoly-vectors](https://github.com/donutheist/monopoly-vectors), pinned to commit `6a68e5f76a5530134efe6613e8bda1ea79329ef3`.

The repository author describes scanning physical Chance and Community Chest cards and tracing their illustrations. These files are sourced reproductions of classic artwork; they are not newly generated illustrations or a Hasbro asset release. The repository has no license file and GitHub reports no identified license. Preserve the author/repository credit and this provenance record. No formal redistribution grant or particular attribution license was found, so none is asserted here.

Local files are in `public/assets/card-art/`. The adjacent `manifest.json` maps all 32 current classic card IDs to 31 source images (the two nearest-railroad cards share one illustration), and records the exact original filenames. Source URLs use the pinned commit plus `SVG/` or `PNG/` and the URL-encoded original filename. Files were downloaded unchanged; no repository scripts, fonts or executable code were used.

There are 27 SVGs and four original PNGs, approximately 1.7 MB total including the manifest. The SVGs were checked for scripts, event handlers, embedded foreign objects and linked resources; none were found. Four upstream Community Chest SVGs consist almost entirely of solid rectangles, so the corresponding original PNGs are used for GO, Bank Error, Holiday Fund and Inheritance. Those PNGs use palette transparency; their transparent palette entries retain blue RGB values, which can appear blue in viewers that ignore transparency. Browsers should display them normally over the card surface.

The source collection predates two names used in the selected 2008-era game rules: the Poor Tax illustration is mapped to the $15 Speeding Fine effect, and the Grand Opera illustration to Birthday. These are reused historical illustrations, not recovered artwork for those later card printings. All card text and payment rules still come from the game data. The manifest records both substitutions.

Use these illustrations only for the Classic deck. The files do not authenticate Inland Empire's Big Fun or Contingency artwork and should not be displayed as recovered Inland Empire cards. Its two verified local effects and clearly disclosed fallback cards keep their own provenance.

Suggested in-app credit: “Classic card illustrations: donutheist/monopoly-vectors, reproduced from physical cards.” Link the repository. Do not describe these as freely licensed, public-domain, or official downloadable art.
