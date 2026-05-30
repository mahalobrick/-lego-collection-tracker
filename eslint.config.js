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
      "no-restricted-syntax": ["error", noRawSetItem],
    },
  },
  // The ONE sanctioned raw-write module (the choke point + the atomic-rollback revert).
  {
    files: ["src/utils/safeStorage.js"],
    rules: { "no-restricted-syntax": "off" },
  },
  // Tests legitimately seed localStorage fixtures directly (arrange step, not app writes).
  {
    files: ["src/**/*.test.{js,jsx}"],
    rules: { "no-restricted-syntax": "off" },
  },
];
