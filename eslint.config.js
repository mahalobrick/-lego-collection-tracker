// Minimal, single-purpose ESLint config — NOT a general style linter.
//
// Its only job is to lock the DATA-4 invariant: every BrickLedger localStorage write must go
// through setItemSafe() (src/utils/safeStorage.js), the guarded choke point that enforces the
// quota policy (OBS-2) and dispatches the brickledger:datachange auto-push trigger. A raw
// localStorage.setItem silently bypasses BOTH, so it is banned everywhere except the two
// sanctioned sites inside safeStorage.js (setItemSafe itself + restoreRaw, the atomic-rollback
// revert). Run via `npm run lint`; wire into CI to make a regression unmergeable.
//
// Deliberately scoped to this one rule so adding ESLint to a never-linted codebase doesn't
// bury the signal under hundreds of pre-existing style violations. Known gap: a static rule
// can't see an aliased write (const s = localStorage; s.setItem(...)); no code does this and it
// is a code-review concern — the lint stops the realistic accidental reintroduction.

// The codebase carries inline `// eslint-disable-next-line react-hooks/exhaustive-deps`
// directives from a previously-removed ESLint setup. Stub that rule name (no-op) so the
// directives resolve instead of erroring "rule definition not found" — without pulling the
// full react-hooks plugin into this single-purpose config. We don't lint hook deps here.
const reactHooksStub = {
  rules: { "exhaustive-deps": { create: () => ({}) } },
};

const noRawSetItem = {
  // Bans `localStorage.setItem(...)` (and `window.localStorage.setItem(...)`) call expressions.
  selector:
    "CallExpression[callee.property.name='setItem'][callee.object.name='localStorage']," +
    "CallExpression[callee.property.name='setItem'][callee.object.property.name='localStorage']",
  message:
    "Raw localStorage.setItem bypasses the quota guard and the auto-sync trigger (DATA-4). " +
    "Use setItemSafe() from src/utils/safeStorage.js. The only sanctioned raw writes live in " +
    "safeStorage.js (setItemSafe + restoreRaw).",
};

// ── $0-for-unknown ban (Workstream A) ────────────────────────────────────────
// Locks the value invariant from CLAUDE.md: a set's VALUE is consumed only through the
// null-aware funnel (setValueProvenance → formatValue / formatAggregateValue, plus the
// portfolio.js rollups). The class these bans close is the falsy-`||` re-derivation that
// re-opens "$0 means unknown": `s.totalValue || asNumber(s.currentValue) * qty` and
// `money(s.totalValue || …)` — both laundering an unknown value into a phantom $0.00
// instead of "—". After the fix the value reads go through `setValueProvenance(s).amount`
// and the two formatters; these selectors stop the inline pattern from creeping back.
//
// The VALUE fields only (`totalValue`/`currentValue`/`current_value`/`totalRetailPrice`).
// Cost is deliberately NOT covered — a $0 cost can be genuine (GWP), so `paidPrice || …`
// stays legal.
//
// KNOWN GAP — what a single static AST rule cannot safely catch (by design, mirroring the
// setItemSafe rule's honesty about aliased writes). These selectors target the precise
// leak shape — a BARE value member coalesced to a COMPUTED fallback, with or without
// money() — because every broader shape collides with legitimate code:
//   • Generic aggregates: `sets.reduce((s,e) => s + (Number(e.current_value) || 0), 0)`
//     and the retail/sync rollups. A `member || 0` contributor is indistinguishable from
//     the leak to esquery, and banning it would flag every honest "missing → 0 in a sum".
//     These are covered instead by CONVENTION (route through portfolioValue/knownValueCount
//     + formatAggregateValue) + TEST (valueDisplay.unknown.test.js asserts an all-unknown
//     collection renders no $0.00 card).
//   • asNumber/Number-WRAPPED fallbacks (`Number(s.totalValue) || (currentValue * qty)`):
//     structurally identical to in-scope normalization/snapshot code elsewhere; not banned.
//   • `??`-fed valueAmount() (`valueAmount(e.current_value ?? e.value)`): the SANCTIONED
//     per-copy funnel feed (SetDetailPanel) — `??` is intentionally not banned.
//   • Controlled-input defaults (`value={s.currentValue || ""}`): not a value READ.
//   • The Wanted-list `money(item.currentValue)` cells: a separate, deferred class (the
//     $0-MSRP-may-be-a-real-GWP ambiguity) — out of this ban until its own workstream.
// Net: code review + the funnel convention own the gap; the lint stops the realistic
// accidental reintroduction of the exact closed leak.
const FALLBACK_VALUE_FIELDS = "totalValue|currentValue|current_value|totalRetailPrice";
const noUnknownAsZero = [
  {
    // money(<value-member> || <fallback>) — laundering an unknown value into a $0.00 money cell.
    selector:
      `CallExpression[callee.name='money'] > LogicalExpression > MemberExpression.left[property.name=/^(${FALLBACK_VALUE_FIELDS})$/]`,
    message:
      "Unknown value rendered as $0 (Workstream A): money() of a `value || fallback` re-derivation. " +
      "Read setValueProvenance(s).amount and render via formatValue() / formatAggregateValue() " +
      "(src/utils/valueDisplay.js) — unknown is `null` → \"—\", never $0.",
  },
  {
    // <value-member> || <computed recompute> — the bare value-fallback (e.g. `s.totalValue || cur * qty`).
    selector:
      `LogicalExpression[operator='||'][right.type='BinaryExpression'] > MemberExpression.left[property.name=/^(${FALLBACK_VALUE_FIELDS})$/]`,
    message:
      "Unknown value re-derived via `value || <recompute>` (Workstream A) — this re-opens the falsy-$0 " +
      "class. Use setValueProvenance(s).amount (src/utils/portfolio.js); render with formatValue(). " +
      "Unknown is `null` → \"—\", never $0.",
  },
];

// ── Per-copy dual-store ban (G4) ─────────────────────────────────────────────
// Locks the per-copy invariant: a set's copies are read through the ONE funnel —
// materializeEntries() in src/utils/percopy.js — never by iterating `<set>.entries` directly.
// The class this closes is the dual-store footgun: code that does `set.entries.map(...)` /
// `.filter(...)` / `.reduce(...)` silently mishandles a line-level (manual) set, which has no
// entries[] until it's materialized. Route per-copy reads through materializeEntries(set), which
// synthesizes copies for a manual set and passes an entries[]-backed set through.
//
// SCOPE: the precise, realistic leak shape — a method call whose callee object is a MEMBER access
// ending in `.entries` (i.e. `<obj>.entries.<method>(...)`). It deliberately does NOT match a local
// alias (`const e = set.entries; e.map(...)`) — same honest gap the setItem ban documents — nor
// `Object.entries(x)`, `map.entries()`, `groups.entries()` (callee object is an Identifier, not a
// `.entries` member), nor a bare `set.entries || []` storage read.
//
// ALLOWLIST (the legit direct readers, via file overrides below): percopy.js (the funnel itself),
// portfolio.js (the value/cost funnel — valueGroups delegates, the edit helpers operate on stored
// arrays), condition.js (the condition normalizer), and beCollection.js / beSyncValues.js (the BE
// storage-normalization + value-sync layer that reads/writes the raw stored blob). Everything else —
// notably the components — routes through materializeEntries.
const noDirectEntriesIteration = {
  selector:
    "CallExpression[callee.object.type='MemberExpression'][callee.object.property.name='entries']",
  message:
    "Direct per-copy iteration of `<set>.entries` mishandles line-level (manual) sets (G4). " +
    "Read copies through materializeEntries(set) from src/utils/percopy.js — it synthesizes a " +
    "manual set's copies and passes an entries[]-backed set through. The only sanctioned direct " +
    "readers are the funnel + the value/condition/BE-storage layer (see eslint.config.js overrides).",
};

// ── Managed-enrichment-cache clear ban (P3 memo-coherence) ───────────────────
// Locks the memo-coherence invariant: each managed enrichment cache (blValueCache, bricksetSetCache,
// brickEconomySetCache, blPriceGuideCache) is a TWO-part structure — an in-memory memo + the
// localStorage mirror — and the two must stay in lockstep. A raw
// `localStorage.removeItem("bricksetSetCache")` empties the STORE but leaves the module's live memo
// populated, so a memo-aware peek (P3.3) then serves a stale entry the user just tried to clear.
// P3.7a fixed the two real clear sites by routing them through the cache module's clear() (which
// wipes BOTH memo and mirror) and added function-level guards — but those guards test the clear
// FUNCTIONS; nothing stops a FUTURE raw removeItem at a NEW site from re-opening the bug class. This
// rule is the structural close, mirroring DATA-4's no-raw-setItem ban: it forbids the raw store wipe
// so every clear of a managed key is forced through the owning module's clear().
//
// The sanctioned clear path lives in enrichmentCache.js (clear() → memo.clear() + setItemSafe the
// mirror to "{}"); the four wrapper modules that OWN a managed key are allowlisted via the file
// overrides below: valueCache.js (blValueCache), brickset.js (bricksetSetCache), beSyncValues.js
// (brickEconomySetCache), bricklink-client.js (blPriceGuideCache). Everything else routes its clear
// through that module.
//
// KNOWN GAPS — what a single static AST rule cannot safely catch (mirroring the setItem ban's
// honesty about aliased writes):
//   • Aliased store: `const s = localStorage; s.removeItem("blValueCache")` — callee object is a
//     local Identifier, not `localStorage`; not matched. No code does this; a code-review concern.
//   • Dynamic key: `localStorage.removeItem(someVar)` / a template literal — the argument is not a
//     string Literal, so the managed-key regex can't read it. The realistic accidental
//     reintroduction is a hard-coded key string, which this catches.
//   • `localStorage.clear()` is banned unconditionally (it wipes the managed mirrors too, leaving
//     every memo stale) — but only in app code; tests legitimately clear() in teardown and are
//     exempt via the test override.
const MANAGED_CACHE_KEYS = "blValueCache|bricksetSetCache|brickEconomySetCache|blPriceGuideCache";
const noRemoveManagedCache = [
  {
    // localStorage.removeItem("<managed key>") / window.localStorage.removeItem("<managed key>")
    selector:
      `CallExpression[callee.property.name='removeItem'][callee.object.name='localStorage'][arguments.0.value=/^(${MANAGED_CACHE_KEYS})$/],` +
      `CallExpression[callee.property.name='removeItem'][callee.object.property.name='localStorage'][arguments.0.value=/^(${MANAGED_CACHE_KEYS})$/]`,
    message:
      "Raw removeItem of a managed enrichment cache key empties the store but leaves the module's " +
      "in-memory memo populated, so a later memo-aware peek serves a stale entry (P3 memo coherence). " +
      "Clear through the owning module's clear() (valueCache/brickset/beSyncValues/bricklink-client, " +
      "backed by enrichmentCache.clear()) — it wipes BOTH the memo and the mirror.",
  },
  {
    // bare localStorage.clear() / window.localStorage.clear() — wipes the managed mirrors too.
    selector:
      "CallExpression[callee.property.name='clear'][callee.object.name='localStorage']," +
      "CallExpression[callee.property.name='clear'][callee.object.property.name='localStorage']",
    message:
      "localStorage.clear() wipes the managed enrichment cache mirrors but leaves their in-memory " +
      "memos populated, re-opening the P3 memo-coherence bug class. Clear individual caches through " +
      "their owning module's clear(). (Tests are exempt — they clear() in teardown.)",
  },
];

// ── Raw condition-bucketing ban (Overview New/Used/Mixed gap) ────────────────
// Locks the condition invariant: a set's New/Used/Mixed bucket is derived ONLY through the canonical
// normalizer — setConditionDisplay() / conditionBucket() (src/utils/condition.js) — never by matching the
// raw `s.condition` string at the call site. The class this closes: the Overview value cards bucketed on
// the raw string (`s.condition === "sealed"` for New, `s.condition.startsWith("used")` for Used), so a BE
// multi-copy set stored set-level condition "mixed" matched NEITHER and its value vanished from New+Used
// (the ~$3.4k gap vs Collection Value). Routed through setConditionDisplay the three buckets are total +
// disjoint (conditionValueBuckets in portfolio.js), so the partition can't leak a set.
//
// SCOPE — the two precise leak shapes, mirroring the other bans' honesty about what a static rule catches:
//   • `<obj>.condition.startsWith(...)`  — the used-bucket signature conditionBucket exists to replace.
//   • `<obj>.condition === / !== "sealed"` — the set-level "sealed counts as New" tell (both orientations).
// It deliberately does NOT flag a bare `<obj>.condition === "new"` equality: that exact shape has legit
// per-copy / import uses (e.g. AppSettings' BE-CSV import summary splits raw per-copy rows new-vs-rest,
// where no 'mixed' exists), and banning it would false-positive that handling. A New/Used SET partition
// always needs a used check, and the idiomatic one is `.startsWith("used")` — so banning that reliably
// breaks the buggy pattern; the conditionValueBuckets invariant test (portfolio.conditionBuckets.test.js)
// is the semantic backstop. `String(x.condition).startsWith(...)` is also not matched (callee object is the
// String() call, not the member) — the realistic accidental reintroduction is the bare member form.
//
// ALLOWLIST: condition.js (defines the normalizer) + beCollection.js (the BE storage layer that calls
// setConditionDisplay to STORE the set-level "mixed") — both in the per-copy override block below, which
// re-lists its rules without this one. Components + the value funnel get it.
const noRawConditionBucketing = [
  {
    selector:
      "CallExpression[callee.property.name='startsWith'][callee.object.type='MemberExpression'][callee.object.property.name='condition']",
    message:
      "Raw condition bucketing: `<set>.condition.startsWith('used')` re-opens the New/Used/Mixed gap " +
      "(a 'mixed' set matches neither New nor Used). Bucket via setConditionDisplay(set) / conditionBucket(raw) " +
      "from src/utils/condition.js — 'new'|'used'|'mixed', total + disjoint (see conditionValueBuckets).",
  },
  {
    selector:
      "BinaryExpression[operator=/^[!=]==$/][left.property.name='condition'][right.value='sealed']," +
      "BinaryExpression[operator=/^[!=]==$/][right.property.name='condition'][left.value='sealed']",
    message:
      "Raw condition bucketing: comparing `<set>.condition` to \"sealed\" re-opens the New/Used/Mixed gap. " +
      "Bucket via setConditionDisplay(set) / conditionBucket(raw) from src/utils/condition.js " +
      "('new'|'used'|'mixed', total + disjoint — see conditionValueBuckets).",
  },
];

module.exports = [
  {
    files: ["src/**/*.{js,jsx}"],
    plugins: { "react-hooks": reactHooksStub },
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    // The codebase's hook-dep disable directives are intentionally redundant here (rule is a
    // no-op stub), so don't flag them as unused.
    linterOptions: { reportUnusedDisableDirectives: "off" },
    rules: {
      "no-restricted-syntax": ["error", noRawSetItem, ...noUnknownAsZero, noDirectEntriesIteration, ...noRemoveManagedCache, ...noRawConditionBucketing],
    },
  },
  // The ONE sanctioned raw-write module (the choke point + the atomic-rollback revert).
  {
    files: ["src/utils/safeStorage.js"],
    rules: { "no-restricted-syntax": "off" },
  },
  // The sanctioned VALUE funnel — these modules DEFINE the null-aware path the ban points
  // people toward, so they legitimately touch the raw value fields (Workstream A). portfolio.js
  // is ALSO the per-copy value funnel (valueGroups delegates to materializeEntries; the edit
  // helpers operate on already-stored arrays), so it's exempt from the entries ban here too. They
  // do NOT clear caches, so they keep the managed-cache ban.
  {
    files: ["src/utils/valueDisplay.js", "src/utils/portfolio.js", "src/utils/value.js"],
    rules: { "no-restricted-syntax": ["error", noRawSetItem, ...noRemoveManagedCache, ...noRawConditionBucketing] },
  },
  // The sanctioned PER-COPY layer (G4): the funnel itself, the condition normalizer, and the BE
  // storage-normalization layer legitimately read the raw stored entries[]. They get every ban
  // EXCEPT noDirectEntriesIteration (beSyncValues is split out below — it ALSO owns a managed cache).
  {
    files: ["src/utils/percopy.js", "src/utils/condition.js", "src/utils/beCollection.js"],
    rules: { "no-restricted-syntax": ["error", noRawSetItem, ...noUnknownAsZero, ...noRemoveManagedCache] },
  },
  // The managed-enrichment-cache OWNERS (P3 memo-coherence): each wraps an enrichmentCache instance
  // for one managed key and defines the sanctioned clear() the ban points people toward, so they are
  // exempt from noRemoveManagedCache. enrichmentCache.js is the shared clear primitive. They keep
  // every OTHER ban (none of them iterate `<set>.entries`, so noDirectEntriesIteration stays).
  {
    files: ["src/utils/enrichmentCache.js", "src/utils/valueCache.js", "src/utils/brickset.js", "src/utils/bricklink-client.js"],
    rules: { "no-restricted-syntax": ["error", noRawSetItem, ...noUnknownAsZero, noDirectEntriesIteration] },
  },
  // beSyncValues.js is BOTH a per-copy raw-entries reader (G4, exempt from noDirectEntriesIteration)
  // AND the brickEconomySetCache owner (P3, exempt from noRemoveManagedCache). It keeps the rest.
  {
    files: ["src/utils/beSyncValues.js"],
    rules: { "no-restricted-syntax": ["error", noRawSetItem, ...noUnknownAsZero] },
  },
  // Tests legitimately seed localStorage fixtures directly (arrange step, not app writes)
  // and assert against raw value fields.
  {
    files: ["src/**/*.test.{js,jsx}"],
    rules: { "no-restricted-syntax": "off" },
  },
];
