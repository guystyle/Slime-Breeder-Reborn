# Slime Breeder Reborn

A modern web restoration of **Slime Breeder** (1999, tatuta; English version by rika), the genetic
evolution ladder game once hosted at `cgi.heyuri.net/slime/`.

> Fan reimplementation. The original CGI source is not public, so the DNA, stat and battle
> formulas are **re-derived from the in-game guide and observed screens**, not copied.
> Tuning will differ from the original. The slime sprite is redrawn as SVG. Check the
> original author's terms before any public deployment.

## Run

```sh
npm install
npm run build          # client -> dist/
npm start              # http://localhost:3000 (SQLite file: ./slime.db)
```

Dev: `npm run dev:server` + `npm run dev:client` (Vite proxies `/api`).
Env: `PORT`, `SLIME_DB` (db path), `SLIME_COOLDOWN_MIN` (default 15, `0` to disable).
Requires Node >= 22.13 (uses built-in `node:sqlite`).

## Game rules implemented

- Log in with name + password (first login registers; passwords hashed with scrypt).
- Pick a mate from the top-50 ranking (not slimes with 0 seeds) -> child with mixed DNA -> name it -> fight.
- DNA: 9 traits x 2 strands (dominant strand expressed, other hidden); mutations equally likely up or down.
- Battle: SPD fills an energy bar, DEX vs SPD decides hits, STR is damage; stamina costs 4/1/6
  (attack/evade/hit), weaker below 50%, half strength at 0.
- Ladder: start at 1 pt, fight upward through slimes with more points (top 3 always), lose = stop.
  Beat the champion with more points to take the title; champions with >3 defenses enter the Hall of Fame.
- 15-minute play cooldown; accounts idle for 7 days are purged; one-liner comments.

## Genetics (beyond stats)

- Colour: three colour genes (R/G/B) in 5 steps, like the original's palettes (founders are grey).
- Size: the sprite grows with weight using the original's measured relation (50 -> ~67px, 250 -> ~116px).
- Mutations (**this restoration's own design** - the original's hidden mutations are unknown): `wings`
  (lighter, faster, flapping), `metal` (heavier, more HP, glossy), `horn` (stronger hits). Each is a rare
  gene that appears spontaneously (~1.2% per strand), travels through families, can hide for a generation,
  and only *shows* when the body suits it (e.g. wings need light size + reflex).

## Battle calibration

Constants were tuned against the 50 ranked slimes on the original ranking page and its guide sample:
attacks per side 22-45, hit rate ~45%, stamina left 5-30%, avg damage 5-9 x STR (`npm test` checks these).
Stat formulas follow the original's weight relations (HP and STR track weight; DEX and SPD fall with it).

## Known gaps vs. the original

- The original's own hidden mutations are unknown; the three above are new.
- Point values per win and the exact DNA->stat formulas are approximations (battle numbers are calibrated, not copied).

## Layout

`src/shared` (DNA, stats, battle, ladder rules) · `src/server` (Hono API + SQLite) · `src/client` (Vite, vanilla TS)
