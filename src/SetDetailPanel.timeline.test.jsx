import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import SetDetailPanel from "./SetDetailPanel";

// ─────────────────────────────────────────────────────────────────────────────
// Timeline section — released + retired dates sourced from the Brickset device
// cache (bricksetSetCache, keyed `brickset_<n>`, fields launch_date / exit_date /
// year). The panel opens on the RAW BE blob, which carries none of these, so the
// Timeline derives them from `bs` — the same cache the chips / MSRP already read.
//   • Released = fmtShortDate(launch_date), falling back to the year string.
//   • Retired  = item.retired ? fmtShortDate(exit_date) : "Active". A FUTURE
//     exit_date on an ACTIVE set is NOT rendered as a retirement date — the
//     header "Retires in Nd" countdown already covers that.
// Dates are ISO-datetime-safe (Brickset emits "2017-10-01T00:00:00Z") with no UTC
// off-by-one. Assertions are scoped to the Timeline section's own DOM so the year
// chip / header status badge can't satisfy them by accident.
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

// Same local-parts construction + en-US formatting that parseLocalDate + the panel's
// fmtShortDate use, so the expected string equals the panel's output regardless of the
// runtime's ICU build. (mZeroBased mirrors `new Date(y, m-1, d)`.)
const fmt = (y, mZeroBased, d) =>
  new Date(y, mZeroBased, d).toLocaleDateString("en-US", { month: "short", year: "numeric" });

function seedBrickset(setNumber, data) {
  const cache = JSON.parse(localStorage.getItem("bricksetSetCache") || "{}");
  cache[`brickset_${setNumber}`] = { fetchedAt: "2026-06-01T00:00:00.000Z", data };
  localStorage.setItem("bricksetSetCache", JSON.stringify(cache));
}

function renderPanel(item) {
  act(() =>
    root.render(
      <SetDetailPanel item={{ condition: "new", quantity: 1, entries: [], ...item }} onClose={() => {}} />,
    ),
  );
}

// Scope to the Timeline section alone: the leaf sectionLabel div whose text is exactly
// "Timeline"; return its parent section's textContent (label + the two tiles).
function timelineText() {
  const label = [...container.querySelectorAll("div")].find(d => d.textContent === "Timeline");
  return label ? label.parentElement.textContent : null;
}

describe("SetDetailPanel — Timeline (released + retired from Brickset cache)", () => {
  it("retired set: Released shows launch_date, Retired shows the exit DATE", () => {
    seedBrickset("12345-1", { launch_date: "2015-03-01T00:00:00Z", exit_date: "2017-10-01T00:00:00Z", year: 2015 });
    renderPanel({ setNumber: "12345-1", retired: true });
    const t = timelineText();
    expect(t).toBeTruthy();
    expect(t).toContain(fmt(2015, 2, 1)); // Released = "Mar 2015"
    expect(t).toContain(fmt(2017, 9, 1)); // Retired  = "Oct 2017"
  });

  it("active set: Retired shows 'Active', and a future exit_date is NOT rendered as a date", () => {
    seedBrickset("12345-1", { launch_date: "2019-05-01T00:00:00Z", year: 2019, exit_date: "2031-01-01T00:00:00Z" });
    renderPanel({ setNumber: "12345-1", retired: false });
    const t = timelineText();
    expect(t).toContain(fmt(2019, 4, 1)); // Released = "May 2019"
    expect(t).toContain("Active"); // Retired tile
    expect(t).not.toContain(fmt(2031, 0, 1)); // future exit "Jan 2031" not shown as a retirement date
  });

  it("Released falls back to the year string when launch_date is absent", () => {
    seedBrickset("12345-1", { year: 2018 }); // no launch_date, no exit_date
    renderPanel({ setNumber: "12345-1", retired: false });
    const t = timelineText();
    expect(t).toBeTruthy();
    expect(t).toContain("2018"); // Released falls back to the year (scoped to the tile, not the chip)
    expect(t).toContain("Active"); // Retired tile (not retired)
  });
});
