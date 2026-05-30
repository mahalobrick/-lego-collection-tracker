import {ClerkProvider} from "@clerk/react";
import "./index.css";
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { runMigrations } from './utils/migrate'

// Data writes go through setItemSafe (src/utils/safeStorage.js), the single guarded
// choke point that surfaces QuotaExceeded and dispatches "brickledger:datachange" for
// the debounced auto-push in App.jsx. This replaces the former global setItem patch.

runMigrations();
ReactDOM.createRoot(document.getElementById('root')).render(<ClerkProvider afterSignOutUrl="/">
      <App />
    </ClerkProvider>)