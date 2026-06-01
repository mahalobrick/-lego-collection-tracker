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
      "no-restricted-syntax": ["error", noRawSetItem, ...noUnknownAsZero],
    },
  },
  // The ONE sanctioned raw-write module (the choke point + the atomic-rollback revert).
  {
    files: ["src/utils/safeStorage.js"],
    rules: { "no-restricted-syntax": "off" },
  },
  // The sanctioned VALUE funnel — these modules DEFINE the null-aware path the ban points
  // people toward, so they legitimately touch the raw value fields (Workstream A).
  {
    files: ["src/utils/valueDisplay.js", "src/utils/portfolio.js", "src/utils/value.js"],
    rules: { "no-restricted-syntax": ["error", noRawSetItem] },
  },
  // Tests legitimately seed localStorage fixtures directly (arrange step, not app writes)
  // and assert against raw value fields.
  {
    files: ["src/**/*.test.{js,jsx}"],
    rules: { "no-restricted-syntax": "off" },
  },
];
