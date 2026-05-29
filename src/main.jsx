import {ClerkProvider} from "@clerk/react";
import "./index.css";
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { runMigrations } from './utils/migrate'

// Emit "brickledger:datachange" whenever a real data key changes so App.jsx
// can debounce an auto-push.  Metadata, cache, and push-internal keys are
// excluded to prevent loops and noisy triggers.
const SYNC_SKIP_KEYS = new Set([
  "blLastPushHash", "blLastCloudPush", "blLastAutoExport", "blLastTab",
  "blLastNotifyDate", "blSyncedUserId", "bricksetSetCache", "brickEconomySetCache",
  "brickEconomyCollectionCache", "blPriceGuideCache",
  "blSessionToken", "blBrickLinkAccessToken",
]);
const _origSetItem = localStorage.setItem.bind(localStorage);
const _origGetItem = localStorage.getItem.bind(localStorage);
localStorage.setItem = function patchedSetItem(key, value) {
  // Only treat a write as a data change if the stored value actually differs.
  // Components re-write identical data in their save effects on mount (e.g. on tab
  // switch); those no-op writes must NOT trigger the sync indicator/push.
  const changed = _origGetItem(key) !== String(value);
  _origSetItem(key, value);
  if (changed && !SYNC_SKIP_KEYS.has(key) && (key.startsWith("bl") || key.startsWith("brickEconomy"))) {
    window.dispatchEvent(new CustomEvent("brickledger:datachange"));
  }
};

runMigrations();
ReactDOM.createRoot(document.getElementById('root')).render(<ClerkProvider afterSignOutUrl="/">
      <App />
    </ClerkProvider>)