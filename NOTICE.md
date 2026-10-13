# Credits and licence notice

**Slime Breeder Reborn** is a modified, re-implemented version of the game
**SLIME BREEDER** by **tatuta** (1999), in particular of **SLIME BREEDER plus v1.08**
(Copyright 1999-2002 tatuta, <http://www2j.biglobe.ne.jp/~tatuta/_MENU.htm>).
The English edition was translated by rika.

The author's readme (kept unmodified in
[`licenses/SLIME-BREEDER-plus-readme.txt`](licenses/SLIME-BREEDER-plus-readme.txt)) allows modified
redistribution from v1.07 on, under conditions this project follows:

- **Your own ideas added:** new web stack (TypeScript, SQLite, Vite), Korean and English UI, animated
  battle replay, particle and text effects, tests, and the rule adaptations listed in the README.
- **Readme attached:** see the file above.
- **Author's copyright and link kept** in the page footer, and the footer shows that this is a
  modified version with the modifier's link.
- No second-copyright claims are made on the derived rules; no changes were made to disadvantage the author.
- Redistribution will stop promptly if the author asks.
- **Non-commercial only:** the readme says commercial use requires a fee payable to the author.

Ported from the original source (algorithms re-implemented, not copied line by line): gene structure and
expression, status formulas, mutant conditions, battle engine, point transfer and ladder flow, seed
regrowth, and the bloodline ("keito") and nicks system. Not ported: the players' skill ranking page and the
admin "god mode" pages.

**Artwork:** the slime sprites and the two panel background strips are tatuta's GIFs from the plus v1.08
package. They are included converted to PNG (`src/client/sprites.gen.ts`, produced by
`scripts/convert_sprites.py`) under the redistribution terms above. The pixel art itself was not altered.
