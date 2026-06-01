# Brickset fixtures — `getSets` / `getThemes` field-select contract (P4)

Real Brickset API payloads captured live on **2026-05-31** via
[`scripts/capture-brickset.mjs`](../../scripts/capture-brickset.mjs) (key from `.env.local`).
This is the **contract** the field-select proxies (`api/brickset-set.js`, `api/brickset-search.js`,
`api/brickset-themes.js`) are tested against — [`src/utils/brickset.contract.test.js`](../../src/utils/brickset.contract.test.js).
Do not hand-edit; re-run the script to refresh.

Each file is the **verbatim** upstream JSON. Brickset's **`getSets`** endpoint backs BOTH `/api/brickset-set`
(`params={setNumber}`) and `/api/brickset-search` (`params={query|theme}`) — same `sets[]` element shape,
different params + field-select. `getThemes` backs `/api/brickset-themes`.

```jsonc
{ "status": "success", "matches": 1, "sets": [ { /* set element */ } ] }   // getSets
{ "status": "success", "themes": [ { "theme": "...", "setCount": N, ... } ] } // getThemes
{ "status": "error", "message": "..." }                                       // failure (proxy → envelope)
```

## Fixtures

| File | Case | Notable |
|---|---|---|
| `set-75192.json` | big retired-soon (UCS Falcon) | full payload; `LEGOCom.US.retailPrice` 849.99, dimensions, 30+ tags |
| `set-10300.json` | D2C (BTTF Time Machine) | full |
| `set-10363.json` | current 2025 (da Vinci) | full; `availability:"Retail"` |
| `set-30432.json` | **sparse polybag (The Turtle Beach)** | **`LEGOCom.US:{}`, `ageRange:{}`, `barcode:{}` — empty objects** |
| `search-millennium-falcon.json` | multi-result search | `matches:42`, returns `pageSize` 20; `sets[0]`=75426, `extendedData:{}` |
| `themes.json` | `getThemes` | 172 themes |

## The pinned shapes (the fields each proxy field-selects)

**`/set` — `sets[0]` → proxy `data.*`.** Every source path below is present on the full fixtures (the
optional ones are pinned via the sparse matrix):

| Upstream path | type | → proxy field | client-consumed? |
|---|---|---|---|
| `number` (string) + `numberVariant` (number) | | `set_number` | ✅ |
| `name` (string) | | `name` | ✅ |
| `year` (number) | | `year` | ✅ |
| `theme` / `themeGroup` / `subtheme` (string) | | `theme` / `theme_group` / `subtheme` | ✅ theme, subtheme |
| `pieces` / `minifigs` (number) | | `pieces` / `minifigs` | ✅ |
| `rating` / `reviewCount` (number) | | `rating` / `review_count` | |
| `packagingType` / `availability` / `bricksetURL` (string) | | `packaging_type` / `availability` / `brickset_url` | |
| `released` (boolean), `instructionsCount` (number) | | `released` / `instructions_count` | |
| `launchDate` / `exitDate` (**ISO datetime string**) | | `launch_date` / `exit_date` | ✅ |
| `LEGOCom.{US,UK,CA,DE}.retailPrice` (number, **optional**) | | `retail_price_{us,uk,ca,de}` | ✅ us |
| `ageRange.min` (number, **optional**) | | `age_min` | |
| `dimensions.{height,width,depth}` (number) | | `height`/`width`/`depth` | |
| `image.{imageURL,thumbnailURL}` (string) | | `image_url` / `thumbnail_url` | ✅ thumbnail |
| `collections.{ownedBy,wantedBy}` (number) | | `owned_by` / `wanted_by` | |
| `barcode.EAN` (string, **optional**) | | `ean` | |
| `extendedData.tags` (string[], **optional**) | | `tags` | |

The **11 client-consumed** proxy fields (MyCollection/WantedList autofill): `set_number, name, theme,
subtheme, year, pieces, minifigs, exit_date, launch_date, retail_price_us, thumbnail_url`.

**`/search`** field-selects `number+numberVariant→setNumber, name, theme, subtheme, year, pieces, minifigs,
LEGOCom.US.retailPrice→msrp, availability, image.thumbnailURL→thumbnail` + `matches→total`. **`/themes`**
maps `themes[].theme` → sorted `string[]`.

## Three contract observations (pinned in the test)

1. **Sparse sets return EMPTY OBJECTS, not absent keys.** Polybag `30432`: `LEGOCom.US`, `ageRange`,
   `barcode` are present but `{}` — so `retail_price_us` / `age_min` / `ean` resolve to `null`/`""` via the
   proxy's `(lego.US && lego.US.retailPrice) || null` guards. Read the optional fields defensively.
2. **`exit_date` (`exitDate`) is ALWAYS present — a year-end placeholder, NOT a retirement flag.** Active
   sets carry a current/future year-end (`75192`/`10363` → `2026-12-31`); retired sets a past year-end
   (`30432` → `2022-12-31`). Consumers compare the **date** (`new Date(exit_date) < new Date()`), never
   presence. Do not treat "has `exit_date`" as "retired."
3. **`launchDate`/`exitDate` are ISO datetimes** (`"2017-10-01T00:00:00Z"`), not `YYYY-MM-DD`. Consumers
   `new Date(...)` them.

## What this lock does (and does NOT) — see integration-standard §5

This is a **static-fixture** contract test: it locks **code-conformance** to the captured shape (the
field-select / consumer mapping can't silently mis-read a real payload) and **documents** the shape +
optionality. It does **not** auto-detect a *live* upstream rename — a frozen fixture can't. Live drift is
caught by **re-running `capture-brickset.mjs` out-of-band** and diffing, not by CI.
