import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import WatchDetailPanel from "./WatchDetailPanel";

// ─────────────────────────────────────────────────────────────────────────────
// BE removal D2 — the wanted-side 2yr/5yr forecast is GONE. BrickEconomy forecasts
// are a single-source black box with no BL/Brickset comp to cross-validate (already
// removed from the owned/MC panel in 378122c; this pins the wanted/watch panel).
// The section must NOT render even when forecast data is present on BOTH the paths
// the old UI read from: the item itself (item.forecast2yr/5yr) AND the BE set cache
// (forecast_value_new_2/5_years). Sibling to SetDetailPanel.retail.test.jsx's
// "investment forecast removed" pin.
// ─────────────────────────────────────────────────────────────────────────────

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container, root;

beforeEach(() => {
  localStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function seedBEForecast(setNumber, f2, f5) {
  const cache = JSON.parse(localStorage.getItem("brickEconomySetCache") || "{}");
  cache[setNumber] = { fetchedAt: "2026-06-01T00:00:00.000Z", data: { forecast_value_new_2_years: f2, forecast_value_new_5_years: f5 } };
  localStorage.setItem("brickEconomySetCache", JSON.stringify(cache));
}

function panelText(item) {
  act(() => root.render(<WatchDetailPanel item={item} onClose={() => {}} />));
  return container.textContent;
}

describe("WatchDetailPanel — wanted-side forecast removed (BE removal D2)", () => {
  it("renders no 2yr/5yr Forecast even when item carries forecast fields", () => {
    const txt = panelText({ setNumber: "10300-1", name: "Test Set", theme: "Icons", forecast2yr: 250, forecast5yr: 400 });
    expect(txt).not.toMatch(/Forecast/);
    expect(txt).not.toMatch(/\$250/);
    expect(txt).not.toMatch(/\$400/);
  });

  it("renders no Forecast even when the BE set cache carries forecast_value_new_2/5_years", () => {
    seedBEForecast("10300-1", 250, 400);
    const txt = panelText({ setNumber: "10300-1", name: "Test Set", theme: "Icons" });
    expect(txt).not.toMatch(/Forecast/);
  });
});
