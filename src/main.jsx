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
localStorage.setItem = function patchedSetItem(key, value) {
  _origSetItem(key, value);
  if (!SYNC_SKIP_KEYS.has(key) && (key.startsWith("bl") || key.startsWith("brickEconomy"))) {
    window.dispatchEvent(new CustomEvent("brickledger:datachange"));
  }
};

runMigrations();
ReactDOM.createRoot(document.getElementById('root')).render(<ClerkProvider afterSignOutUrl="/">
      <App />
    </ClerkProvider>)