# BrickLedger — Visual System Audit

**Purpose:** companion to [`docs/ui-data-inventory.md`](ui-data-inventory.md). That one covered *what data + how shown*; this one covers *what visual system + how consistent*. **Read-only audit — no redesign proposals, only the inventory + flagged inconsistencies.**

**Method:** static extraction (grep over `src/`) of every color/size/spacing literal, plus **live ground-truthing** of rendered button/input sizes in the running preview (signed-out Wanted view). Counts are repo-wide across the 8 component files + 2 style modules.

---

## 0. Styling approach (the framing)

**Approach: inline `style={{}}` objects, hand-written, no styling framework.**

| Signal | Count | Meaning |
|---|---|---|
| `style={{` inline blocks | **1,285** | the primary styling mechanism |
| `className=` usages | **11** | near-zero; only on a handful of elements targeted by the injected `<style>` (`.app-shell`, `.nav-pill`, `.owned-table-scroll`…) |
| CSS custom properties (`--token:`) | **0** | **no token layer exists** |
| Tailwind / CSS-modules / styled-components / emotion / sass | **none** | not in `package.json`; only `recharts` ships its own styles |

**The three style sources:**
1. [`src/index.css`](src/index.css) (83 lines) — global resets + form-control styling (`input/select/textarea`), the only place with a real `:focus` rule, autofill fix, custom select arrow, checkbox `accent-color`. Hardcodes `#050505`, `#e8e2d5`, `#1e3248`, `#c9a84c` directly.
2. An **injected `<style>` block** in [`App.jsx:322`](src/App.jsx:322) — self-hosted `@font-face` (Inter + JetBrains Mono), `box-sizing` reset, keyframes (`spin`, `pulse-dot`), scrollbar styling, and **all 3 CSS media queries** in the app.
3. [`src/uiStyles.js`](src/uiStyles.js) (37 lines) — **the only shared style objects in the codebase**: `searchInput`, `filterSelect`, `clearFilterButton`, `filterBar`. Four objects. Everything else is per-site inline.

**Bottom line:** there is **no token foundation**. Every color, size, and spacing value is a literal embedded at its use-site across ~14k lines. Establishing tokens would be greenfield, not refactoring an existing system.

---

## 1. Typography

**Font families (2):**
- **Inter** — self-hosted variable font (`weight 100–900`, [`App.jsx:324`](src/App.jsx:324)); body default. Verified applied live (`bodyFont = "Inter, …"`).
- **JetBrains Mono** — self-hosted variable (`100–800`); monospace for set numbers / order labels.
- Fallback stack: `-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`.

**Font sizes — 21 distinct values, ad-hoc (no scale):**
`7, 9, 10, 11, 11.5, 12, 13, 13.5, 14, 15, 16, 17, 18, 20, 22, 24, 28, 32, 36, 40, 48`

- Heavy clustering at the small end: **`13` (159×), `12` (129×), `11` (128×)** carry the table/label UI; `14` (50×) for body. Everything ≥20 is a one-to-few-off display size.
- **Odd half-pixel values** `11.5` (2×) and `13.5` (1×) — almost certainly accidental, no rationale.
- No modular scale (no consistent ratio); sizes were picked per-spot.

**Font weights — 5 distinct, skews very bold:**
`700` (205×) · `900` (49×) · `800` (46×) · `600` (24×) · `400` (6×). The UI runs heavy — `700` is the *default* and body-weight `400` is rare. This is a stylistic choice, but `600/700/800/900` are used somewhat interchangeably for "emphasis" without a clear rule.

**Line-height:** mostly browser `normal`; a handful pin fixed px equal to (or below) the font-size — e.g. sub-tabs set `lineHeight: 14px` on `fontSize: 14px` (`1.0`, very tight) and badges `15.6px`. No line-height scale.

**Letter-spacing:** ~10 distinct values (`0.3–0.8`, plus `0` and large display tracking), **polluted by whitespace duplicates** — `"0.5"` (23×) vs `"0.5 "` (10×), `"0.6 "` (15×) vs `"0.6"` (4×), `"0.4"`/`"0.4 "`, `"0.3 "`/`"0.3"`. The trailing-space variants are the same value typed two ways.

---

## 2. Color

**Distinct color literals: ~136+ (65 hex + 71 rgba), plus named (`transparent` 33×, `white` 3×).** All hardcoded inline; **zero reference any token.** The single most-used color is `#5d6f80` (240×).

### Functional palette (the de-facto system, never named)
| Role | Primary literal(s) | Notes |
|---|---|---|
| App background | `#0d1623` / `#0b1020` / `#050505` + a radial-gradient | near-black navy |
| Primary text | `#e8e2d5` (164×) | warm cream |
| Secondary text | `#8a9bb0` (179×) | blue-grey |
| Tertiary / muted / borders | `#5d6f80` (240×), `#4d5e70`, `#3d4f60` | the muted family |
| **Gold accent** (active tab, highlight) | `#c9a84c` (119×) | the brand color (per CLAUDE.md) |
| **Green / positive / action** | `#5aa832` (84×), `#4caf7d`, `#22c55e`, `#10b981`, `#4ade80`, `#86efac`, `#166534`, `#2d5a2d`, `#1a3a1a`, `#0a2e1a`, `#132a1a`… | **8+ greens** |
| **Red / negative / danger** | `#ef4444` (27×), `#ff8b8b` (36×), `#f87171`, `#fca5a5`, `#7f1d1d`, `#991b1b`, `#3b0a0a`, `#4a0a0a` | **8+ reds** |
| **Amber / warning / retiring** | `#f59e0b` (35×), `#fbbf24`, `#f7b731`, `#ffdf74`, `#92400e`, `#78350f`, `#451a03`, `#332500` | **8+ ambers** |
| Blue / info / "paid" series | `#3b82f6` (12×), `#93c5fd`, `#1e40af`, `#1e3248` | |
| Surface panels | `#0f1a28`, `#0b1520`, `#0d1a2a`, `#0a1624`, `#111d2e`, `#111e30`, `#0f1c2e`, `#0f2035` | **~8 near-identical dark surfaces** |

### Flagged near-duplicates & one-offs
- **Dark-surface sprawl:** at least **8 near-black navies** (`#0d1623`, `#0d1a2a`, `#0a1624`, `#0b1520`, `#0f1a28`, `#0f1c2e`, `#111d2e`, `#111e30`, `#0b1020`) all read as "the dark panel" — no canonical surface color.
- **`#3d4f60` (5×) vs `#3d4f63` (1×)** — textbook near-duplicate, differ by 3 in one channel; indistinguishable on screen.
- **3 positive-greens** (`#5aa832` vintage green vs `#4caf7d` mint vs `#22c55e` tailwind-green) used for the same "good/gain" meaning in different files.
- **Multiple "danger reds"** (`#ef4444` vs `#ff8b8b` vs `#f87171` vs `#fca5a5`) for the same negative meaning.
- **White-alpha borders at 11 opacities:** `rgba(255,255,255,…)` appears at `0.02, 0.04, 0.05, 0.06, 0.07, 0.08, 0.1, 0.12, 0.14, 0.15, 0.18` — the "subtle border/divider" has no single value (top three: `0.07` 59×, `0.1` 50×, `0.08` 41×).
- **Gold-alpha at 9 opacities:** `rgba(201,168,76,…)` from `0.03` to `0.5` — accent tints likewise un-systematized.
- **Black-overlay at 7 opacities:** `rgba(0,0,0,…)` `0.2/0.35/0.5/0.55/0.6/0.65/0.7` for shadows/scrims.
- Genuine one-offs (1× each): `#c9c9c9`, `#555`, `#cdd6e2`, `#2f3446`, `#1a0a00`, `#2a0d00`, `#3b2500`, etc.

**boxShadow:** 15 distinct shadow strings — no elevation scale.

---

## 3. Spacing & layout

**No spacing scale.** Values are picked per-site; an 8-ish rhythm is *loosely* present but not enforced.

- **`gap`: 13 distinct** — `1, 2, 3, 4, 5, 6, 8, 10, 12, 14, 16, 20, 24`. Top three: `8` (76×), `10` (55×), `6` (35×). Both `4/5/6` and `10/12/14` clusters appear, so adjacent values do the same job.
- **`borderRadius`: 12 distinct** — `2, 4, 5, 6, 7, 8, 9, 10, 12, 14, 16` + **`999`** (pill). Top: `8` (99×), `10` (69×), `999` pill (57×), `6` (29×). Both `8` and `10` are "the standard corner," and `5/6/7` and `9` are near-dupes of those.
- **`padding`: dozens of shorthand combos**, no scale. Most common `"8px 12px"` (25×), `"10px 14px"` (20×), `"3px 10px"` (12×), `"5px 10px"` (11×), `"14px 16px"` (10×) — but a long tail of `"2px 7px"`, `"5px 8px"`, `"9px 12px"`, `"7px 10px"`, `"4px 10px"`… many differing by 1–2px for no visible reason.

**Layout / containers:**
- App shell max-width **`1400`**, centered (`margin: 0 auto`), `padding: 0`.
- Detail panels (Set/Watch/Purchase drawers) **`420`** wide.
- Assorted modal/tooltip/menu max-widths: `160, 360, 440, 460, 480`, tooltips `minWidth: 240`.

**Responsive — 5 different breakpoints, two mechanisms:**
- **CSS media queries (3):** `max-width: 600px`, `700px`, `800px` — all in the [`App.jsx`](src/App.jsx:339) injected block, scoped to the header/nav only.
- **JS `window.innerWidth` (2):** `< 640` + `matchMedia("(max-width: 639px)")` — **only in [`WantedList.jsx:81`](src/WantedList.jsx:81)**, which is the *only* tab that swaps to a mobile card layout. MyCollection and Budget have no JS breakpoint and keep their tables at all widths.
- So the "mobile boundary" is variously **600 / 639 / 640 / 700 / 800** depending on the file. Tooltips also hard-code viewport math against `window.innerWidth - 280`.

---

## 4. Interactive elements

**150 `<button>` elements, every one inline-styled.** No shared button component, no variant system.

### Button variants (by background, de-facto)
| Variant | ~Count | Use |
|---|---|---|
| Ghost / transparent | 34 | most common — filter/secondary actions, icon buttons |
| Gold fill (`#c9a84c`) | 21 | active tab / primary highlight |
| Green pill (`#5aa832`/`#4caf7d`/`#22c55e`) | 6 explicit (more via borders) | the "action" pill (per CLAUDE.md), e.g. Sync, Add |
| Danger | 0 solid fills | destructive actions use **red text/border**, not a filled variant |

There is no single "primary button" definition — the gold-active-tab, the green action-pill, and the ghost button are each re-specified inline wherever they appear.

### Rendered sizes — **ground-truthed in the preview** (signed-out Wanted view)
All 12 rendered buttons measured **under 44px tall; 5 under 32px:**

| Button | Height × Width | font / weight | padding |
|---|---|---|---|
| Nav tabs (My Collection/Budget/…) | **35 × 87–128** | 13px / 800 | `10px 20px` |
| Sub-tabs (Overview/Tracking/Research) | **34 × 58–63** | 14px / 700 | `8px 0 10px` (lineHeight 14px) |
| Sign In / Sign Up | **26–28 × 68–71** | 12px / 700 | `6px 13px` |
| ⌨ Keys | 27 × 59 | 13px / 400 | `6px 10px` |
| **⚙ gear / ▲ reorder (icon buttons)** | **24 × 26–31** | 13px / 700 | `3px 8px` |

- **Tap targets:** the WCAG/Apple ~44px guideline is **met by nothing**. Nav/sub-tabs sit ~34–35px; the pervasive table icon controls (gear, sort ▲▼, expand) are **~24px square** — the worst offenders, and they're the densest controls in the app (column gears, reorder arrows on every table). Inputs/selects (from `index.css`: `padding 9px 11px`, `font 14px`) compute to ~36px — also under 44.
- **States:**
  - **Hover:** done via **42 inline `onMouseEnter`/`onMouseLeave` handlers** (only ~42 of 150 buttons have any hover feedback); just **2 CSS `:hover` rules** exist. Hover is inconsistent and absent on most buttons.
  - **Focus:** **only `input/select/textarea` get a `:focus` style** ([`index.css:33`](src/index.css:33)). **Buttons have no `:focus` or `:focus-visible` styling at all**, and `outline: none` is set 21× — so **keyboard focus is effectively invisible** across the app's 150 buttons. (Accessibility gap.)
  - **Disabled:** `disabled` used 18× (e.g. "Added ✓" buttons), styled inline per-site.
  - `cursor: pointer` set 136× inline (no shared affordance).

---

## 5. Consistency map (honest summary)

| Dimension | State | Detail |
|---|---|---|
| **Token foundation** | ❌ none | 0 CSS vars, no theme file, no `tailwind.config`. 1,285 inline style objects. Would be **establishing** tokens, not adopting. |
| **Color** | 🔴 patchwork | ~136 literals; 8 dark surfaces, 8 greens, 8 reds, 8 ambers all doing one job each; white/gold/black alphas at 7–11 opacities; true near-dups (`#3d4f60`/`#3d4f63`). A *functional* palette clearly exists in the author's head but is nowhere encoded. |
| **Typography** | 🟠 mostly-consistent intent, ad-hoc values | 2 deliberate self-hosted fonts (good), but 21 sizes with half-pixel accidents, 5 interchangeable bold weights, whitespace-duplicated letter-spacing. Clear *clustering* (11/12/13) shows an implicit scale that was never formalized. |
| **Spacing / radius** | 🟠 loose 8-rhythm, not enforced | 13 gaps, 12 radii, dozens of paddings; standard values (`gap 8/10`, `radius 8/10/999`) dominate but a long tail of ±1–2px one-offs surrounds them. |
| **Buttons / interactive** | 🔴 no system | 150 inline buttons, 3 de-facto variants re-specified per site; **all tap targets <44px**, icon controls ~24px; **no button focus state** (a11y gap); hover only on ~28% of buttons. |
| **Where it IS consistent** | ✅ pockets | `index.css` form controls (one place, uniform); `uiStyles.js` filter bar (4 reused objects — the one genuine shared-component pattern); the self-hosted font setup; `columnDefaults.js` config shape; the gold/green/cream identity is *recognizable* even if its hex values drift. |

**Net:** the app has a **strong, recognizable visual identity** (dark navy + warm cream + gold + green) executed as **~1,300 hand-tuned inline literals with no shared source of truth.** It reads as consistent at a glance because the author reused values *by memory*, but at the literal level it's a patchwork: every category has a small canonical core surrounded by a halo of near-duplicates. The two real, immediate-quality findings (independent of any redesign) are **(1) no keyboard-focus styling on any button**, and **(2) every interactive tap target is under 44px**, with the densest table controls at ~24px.

---

*End of audit. No redesign proposed — inventory + flagged inconsistencies only, ready for review.*
