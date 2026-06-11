# CMF Phase 2 — mapping validation spike (read-only, no code)

**Question:** does a curated-table derivation `our set# → BL catalog ID` hold across the 139 CMF/promo
sets, so the cron can value them? **Answer: YES — with one twist that simplifies the build.**

**Method note (constraint hit):** the repo's BL OAuth1 creds are IP-bound to the VPS — probing from
this machine returns `TOKEN_IP_MISMATCHED` (creds valid, IP rejected), and no VPS SSH alias exists
locally. Validation therefore ran against **BrickLink's public catalog** (via search-indexed catalog
titles + the catalog category listings — BL item pages themselves are bot-gated). That fully answers
ID-resolution + name-alignment (the actual blocker); **sold-price-guide values still need one
confirmation pass on the VPS** (read-only GETs, listed at the end). No BL writes of any kind; no cron
or app changes.

---

## The twist: CMFs resolve as BL **SETs**, not MINIFIGs

BrickLink catalogs every CMF figure TWICE:
- **Set `colNN-N`** — "…(Complete Set with Stand and Accessories)" ← **what the user owns**
- Minifigure `col###` / `colmar13` / `coldnd04` — figure only, no stand/accessories

So the cron needs **NO MINIFIG endpoint branch at all**: the existing `/items/SET/{id}/price` +
ladder work unchanged — Phase 2 reduces to a **work-list mapping** (un-defer CMFs in `setList.mjs`,
translate the number at fetch time, keep writing `value:SET:{ourNumber}` so the app reads it with
zero changes).

⚠️ **Hazard confirmed:** BL's *own* `71048-1/-2/-3/-4` are packaging variants (random fig / complete
series of 12 / box) — e.g. BL `71048-2` = "Complete Series", while OUR `71048-2` = fig #2 (Wolfpack
Beastmaster). Querying raw `7104x-N` would price a whole series as one figure. This is exactly the
"wrong full-box figure" trap the original skip rule existed for; the mapping is mandatory.

## The rule (validated)

```
our "BASE-N"  →  BL SET "<prefix(BASE)>-N"     (N = figure position, verified aligned)
```

Curated per-series prefix table (covers ALL 139 owned CMF/promo items):

| Our base | Series | BL prefix | Figs owned |
|---|---|---|---|
| 71034 | CMF Series 23 | `col23` | 12 |
| 71037 | CMF Series 24 | `col24` | 12 |
| 71038 | Disney 100 | `coldis100` | 18 |
| 71039 | Marvel Studios S2 | `colmar2` | 11 |
| 71045 | CMF Series 25 | `col25` | 12 |
| 71046 | CMF Series 26 (Space) | `col26` | 12 |
| 71047 | Dungeons & Dragons | `coldnd` | 12 |
| 71048 | CMF Series 27 | `col27` | 12 |
| 71049 | F1 Race Cars | `colf1rc` ⚠️ irregular | 12 |
| 71051 | CMF Series 28 (Animals) | `col28` | 12 |
| 71052 | CMF Series 29 | `col29` | 12 |
| 6490363-1 / 6550806-1 | B&N holiday promos | **pass through as-is** (ordinary BL SETs) | 2 |

## Validation table (the sample)

| Our set# | Our name (BE) | BE value | Derived BL ID | Resolved? | Evidence / sanity |
|---|---|---|---|---|---|
| 71034-1 | Nutcracker | $14.64 | `col23-1` | ✓ | BL: "Nutcracker, Series 23 (Complete Set…) : Set col23-1" |
| 71037-2 | Robot Warrior | $3.10 | `col24-2` | ✓ | BL set col24-2 (+ minifig-only col412); ~$10 market noted |
| 71038-2/-4 | Pinocchio / Sorcerer Mickey | $9.64/$6.94 | `coldis100-2/-4` | ✓ | BL: "Pinocchio, Disney 100 … : Set coldis100-2" — our -2 = Pinocchio ✓; Mickey ~$8.75 |
| 71039-1 | Agatha Harkness | $13.02 | `colmar2-1` | ✓ | BL: "Agatha Harkness, Marvel Studios, Series 2 … : Set colmar2-1"; ~$8.99 |
| 71045-3 | Basil the Bat Lord | $18.68 | `col25-3` | ✓ | BL: "Vampire Knight, Series 25 … : Set col25-3" (BL name differs; BrickEconomy 71045-3 = Basil couples them) |
| 71046-1 | Spacewalking Astronaut | $8.29 | `col26-1` | ✓ | BL set col26-1; ~$11 |
| 71047-4 | Dragonborn Paladin | $12.45 | `coldnd-4` | ✓ | BL set coldnd-4; **BL 6-mo avg $13.28** (Brick Ranker) vs BE $12.45 ✓ close |
| 71048-2 | Wolfpack Beastmaster | $92.21 | `col27-2` | ✓ | BL set col27-2; market ~$15 → **our BE $92.21 looks wrong** — BL-primary will correct it |
| 71049-1..4 | RB20/Mercedes/Ferrari/McLaren | $5–10 | `colf1rc-1..4` | ✓ | BL F1 category list: colf1rc-1 Red Bull … colf1rc-4 McLaren — exact positional match |
| 71051-3 | Goldfish Costume Girl | $4.68 | `col28-3` | ✓ | BL: "Goldfish Costume Fan … Set col28-3" — position 3 = goldfish on both sides |
| 71052-1/-3/-4 | Robot T. rex / BIONICLE Cosplayer / Monster Hunter | $4.99 | `col29-1/-3/-4` | ✓ | BL col29-1 Robot T. rex, col29-3 Bionicle Cosplayer, col29-4 Monster Hunter — exact |
| 6490363-1 | By the Fireplace | $23.72 | `6490363-1` (as-is) | ✓ catalog | BL: "By the Fireplace {Barnes & Noble Promotional} : Set 6490363-1" — ~$20 market vs BE $23.72 ✓ |
| 6550806-1 | Gingerbread Lane | $32.96 | `6550806-1` (as-is) | presumed | same promo family; confirm on VPS |

**Positional alignment held in every series checked** (9 distinct series with an explicit
name↔position coupling; S28/S29 verified on three figures each). Names differ across catalogs
(BL "Vampire Knight" = BE "Basil the Bat Lord") — match by POSITION, not name; name is the
human cross-check.

## Edge cases / flags

1. **F1 prefix is irregular** (`colf1rc`, not `colf1`) — exactly why the table is curated, not derived.
2. **Promos:** BL catalogs both as ordinary SETs under their raw numbers — which **contradicts the
   skip-rule comment** in `setList.mjs` ("error on the SET endpoint"). Re-test on the VPS: if the API
   still errors (vs. the catalog page existing), special-case or keep-BE for these 2 (~$57).
3. **Brand-new series (col28/col29, 2026):** will likely return thin/no sold data → the ladder's
   `sold_thin`/`asking`/`modeled_thin` rungs handle this; expect low-confidence bases initially.
4. **BL set-number trap:** never query our raw `71xxx-N` against BL (packaging-variant collision).
5. **Names mismatch by design** (BL generic vs marketing names) — don't name-validate in the cron.
6. **Bonus finding:** our BE value for 71048-2 Wolfpack ($92.21) is ~6× the observed market (~$15) —
   an example of why moving CMFs to BL-primary is worth it beyond consistency.

## Verdict

**The curated-table derivation HOLDS.** Rule: split `BASE-N`, prefix-map via the 11-row table,
re-attach `-N`; promos pass through. No MINIFIG endpoint needed — the existing SET fetch + ladder +
keyspace work unchanged, so the build is: the table + un-defer in `scripts/lib/setList.mjs`
(in-repo, unit-testable) + VPS redeploy. Before building, run the **one VPS confirmation pass**
(read-only price-guide GETs on the ~13 sample IDs above — the throwaway probe script from this spike
is at `/tmp/cmf-spike.mjs`, candidates already filled in) to confirm sold-data availability and the
promo API behavior.

Sources (key): [col23-1](https://www.bricklink.com/v2/catalog/catalogitem.page?S=col23-1) ·
[col24-2](https://www.bricklink.com/v2/catalog/catalogitem.page?S=col24-2) ·
[coldis100-2](https://www.bricklink.com/v2/catalog/catalogitem.page?S=coldis100-2) ·
[colmar2-1](https://www.bricklink.com/v2/catalog/catalogitem.page?S=colmar2-1) ·
[col25-3](https://www.bricklink.com/v2/catalog/catalogitem.page?S=col25-3) ·
[col26-1](https://www.bricklink.com/v2/catalog/catalogitem.page?S=col26-1) ·
[coldnd-4](https://www.bricklink.com/v2/catalog/catalogitem.page?S=coldnd-4) ·
[col27-2](https://www.bricklink.com/v2/catalog/catalogitem.page?S=col27-2) ·
[F1 category](https://www.bricklink.com/catalogList.asp?catType=S&catString=1330.1331) ·
[col28-3](https://www.bricklink.com/v2/catalog/catalogitem.page?S=col28-3) ·
[col29-3](https://www.bricklink.com/v2/catalog/catalogitem.page?S=col29-3) ·
[6490363-1](https://brickset.com/sets/6490363-1/By-the-Fireplace)
