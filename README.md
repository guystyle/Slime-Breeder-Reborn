# Slime Breeder Reborn

A modern web restoration of **Slime Breeder** (1999, tatuta; English edition by rika), the genetic
evolution ladder game once hosted at `cgi.heyuri.net/slime/`. Rules, genetics and the battle engine are
ported from the author's own **SLIME BREEDER plus v1.08** source. **See [NOTICE.md](NOTICE.md)** for credits and
the licence terms (modified redistribution allowed with credit, **non-commercial**).

## Run locally

```sh
npm install
npm run build          # client -> dist/ and the Vercel function bundle -> api/
npm start              # http://localhost:3000, data in ./slime.db (SQLite file)
npm test
```

Dev: `npm run dev:server` + `npm run dev:client` (Vite proxies `/api`). All mutant sprites: `/gallery.html`.
Environment (see `.env.example`): `PORT`, `SLIME_DB` (local db path), `SLIME_COOLDOWN_MIN` (default 15, `0` to disable),
`TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` (use a remote Turso database instead of the local file).
A database from an incompatible schema is refused, not misread.

## Deploy: Vercel + Turso (free tiers)

The data layer is libSQL, so the same code runs on a local SQLite file or on Turso. On Vercel the API is one
self-contained function (`api/[...path].js`, bundled from `src/server` by `scripts/build-api.mjs`; **commit it
after changing server code** — `npm test` fails if it is stale) and the client is static.

1. **Turso:** create a database, then note its URL (`libsql://…`) and create an auth token
   (`turso db create slime-breeder`, `turso db show slime-breeder --url`, `turso db tokens create slime-breeder`,
   or use the Turso dashboard). Tables are created and the world is seeded automatically on the first request.
2. **Vercel:** import this GitHub repository, use the branch you want as production. `vercel.json` already sets the
   build (`npm run build`), output (`dist`), the function and a daily cleanup cron. Add environment variables:
   `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, and `CRON_SECRET` (any long random string).
3. Deploy, then open `https://<your-app>.vercel.app/` and `/api/rank`.

Optional check against a scratch remote database (writes test data!):
`TURSO_DATABASE_URL=… TURSO_AUTH_TOKEN=… npm run smoke:remote`.

## What is ported from the original source

- **Genetics:** two strands of 19 genes. Ten quantitative genes `{value, assertiveness}` (the more assertive
  strand is expressed, close ones blend, so recessive genes resurface later) and nine 0/1 switches for
  colour (R/G/B), shade/mutant gate (X/Y/Z) and ribbon/crown/wing (U/V/W). Offspring genes drift by
  `8` dice whose size follows the world's average weight; a heavy mate widens, a light mate narrows them.
- **Status formulas:** weight, HP, STM, STR, DEX, AGL, SPD, stamina cost and fertility from the ten genes.
  Displayed numbers are divided by 10^n as the species grows (`dispCut`), as in the original.
- **Mutants:** only when X, Y and Z are 1 on all six strands do the U/V/W and colour switches select
  aura, hider, wing, ribbon(+wing), crown(+wing), aho, zombie, oyaji, musi, angel or devil. They are cosmetic.
  Spontaneous flips of a switch group happen at 1 in 200 per group per birth.
- **Battle:** speed fills a gage, DEX vs AGL rolls decide hits, stamina drains per action and weakens
  power/accuracy, heavy blows slow the victim; a near-perfect roll is a critical hit (~1%). Log letters `O X C o x c`.
- **Ladder:** a newborn (1 pt) fights up from the bottom against slimes with at least its points (top 3 always)
  until its first defeat. Beating a slime takes over its points; the slime that ends the run collects all of the
  challenger's points. Totals are divided when the lowest rank reaches three digits. If a non-champion
  out-scores the champion a title defense match is played; a champion dethroned after 4+ defenses enters the
  Hall of Fame. Seeds regrow from each slime's fertility (SEX) every time anyone mates.
- Accounts: name + password (scrypt-hashed), one slime per account, 15-minute play cooldown, 7 days idle = deleted.

- **Bloodlines (keito):** four lineage slots per slime, a child always joins its father's lineage. A 7-digit
  code per lineage (six stat affinities + a type) drives the **nicks** boost on a newborn's stats when affinity
  digits add up to 5 and the four lineages are all different. New lineages come from an **unknown seed**
  (named after the newborn) or from a slime that tops the ladder unbeaten (branch lineage with its genealogy).
  Lineage census, lineage detail with poor-match highlighting, and the compatibility list when choosing a mate.
- **Hall of Fame legends** whose lineage has left the ranking can be mated with (no seed needed), reviving it.
- **Artwork:** the original sprite GIFs (colour-mask + details), see NOTICE.md.

## Look and feel

Early-web look: black page, cyan links, Win95-style beveled controls, and a two-frame layout (title/game
above, results/ranking below, draggable divider) like the original frameset. On top of it: shimmering text,
wavy rainbow logo, ticker for new Hall of Fame entries, an ambient particle layer (bubbles, stars, cursor
sparkles; click bursts), animated battle replay, egg hatching and confetti. Effects can be switched off with
the "effects" button and are disabled by `prefers-reduced-motion`.

On phones (<= 700px wide) the frameset becomes one column with a bottom tab bar (home / ranking / lineages /
hall / more), one view at a time, compact slime cards (collapsible pedigree), stacked forms with 16px inputs
and 44px touch targets, and a lighter particle layer.

## Languages

Korean (default) and English, switchable in the top right; server errors are codes translated by the client.

## What is new in this version

TypeScript + Hono + libSQL (SQLite file or Turso) server, Vite client, the UI features above, tests (including checks against numbers
from the original's ranking page and guide). Regenerate sprites with
`python3 scripts/convert_sprites.py <dir with slm*.gif> src/client/sprites.gen.ts` (needs Pillow).

## Known gaps vs. the original

- The players' skill ranking ("participants") and the admin pages of the plus edition are not ported.
- The English edition showed five stats; the plus engine has a sixth, **AGL** (evasion), which is used here.
- Which long-run balance the world settles into (the English ranking sat at weight ~250) is not verified.
- Numbers of the English edition could only be checked by shape (attack counts, luck averages), not exactly.

## Layout

`src/shared` (genes, lineages, stats, battle, ladder rules) · `src/server` (Hono API + libSQL), `api/` (generated Vercel function) · `src/client` (Vite, vanilla TS)
