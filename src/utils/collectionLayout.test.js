import { describe, it, expect } from "vitest";
import { DEFAULT_COLLECTION_ITEMS, loadCollectionItems } from "./collectionLayout";

// ─────────────────────────────────────────────────────────────────────────────
// Characterization tests for the layout loader — these pin the BEHAVIOUR that was
// previously inline in MyCollection's useState initializer, so the net extraction
// (panel-design SOP commit 1) provably changes nothing. The override-map rework
// (commit 4) will replace these expectations deliberately.
// ─────────────────────────────────────────────────────────────────────────────

describe("loadCollectionItems() — net extraction of the legacy initializer", () => {
  it("returns the defaults (same reference) when nothing is saved", () => {
    expect(loadCollectionItems(null)).toBe(DEFAULT_COLLECTION_ITEMS);
    expect(loadCollectionItems("")).toBe(DEFAULT_COLLECTION_ITEMS);
  });

  it("preserves the user's visible/width/order for known keys, refreshing type+label from defaults", () => {
    const saved = JSON.stringify([
      { key: "value", type: "panel", label: "stale label", visible: false, width: "auto", collapsed: false },
      { key: "qty",   type: "card",  label: "stale label", visible: true,  width: "auto", collapsed: false },
    ]);
    const out = loadCollectionItems(saved);
    // saved order is honoured for the saved keys…
    expect(out[0].key).toBe("value");
    expect(out[1].key).toBe("qty");
    // …user visibility is kept…
    expect(out[0].visible).toBe(false);
    expect(out[1].visible).toBe(true);
    // …but type + label are re-sourced from the defaults (no stale ghosts)
    expect(out[0].type).toBe("card");
    expect(out[0].label).toBe("Collection Value");
    // every other default is appended afterwards, in default order, at its default visibility
    const rest = DEFAULT_COLLECTION_ITEMS.filter(c => c.key !== "value" && c.key !== "qty");
    expect(out.slice(2).map(c => c.key)).toEqual(rest.map(c => c.key));
    expect(out).toHaveLength(DEFAULT_COLLECTION_ITEMS.length);
  });

  it("drops removed keys and folds newSets|usedSets visibility forward into newUsed", () => {
    const saved = JSON.stringify([
      { key: "newSets",      type: "card", label: "New Sets",      visible: true,  width: "auto", collapsed: false },
      { key: "usedSets",     type: "card", label: "Used Sets",     visible: false, width: "auto", collapsed: false },
      { key: "retiringSoon", type: "card", label: "Retiring Soon", visible: true,  width: "auto", collapsed: false },
    ]);
    const out = loadCollectionItems(saved);
    const keys = out.map(c => c.key);
    expect(keys).not.toContain("newSets");
    expect(keys).not.toContain("usedSets");
    expect(keys).not.toContain("retiringSoon");
    // newUsed was visible on either legacy card → carried forward as visible
    expect(out.find(c => c.key === "newUsed").visible).toBe(true);
  });

  it("does NOT mark newUsed visible when neither legacy split card was visible", () => {
    const saved = JSON.stringify([
      { key: "newSets",  type: "card", label: "New Sets",  visible: false, width: "auto", collapsed: false },
      { key: "usedSets", type: "card", label: "Used Sets", visible: false, width: "auto", collapsed: false },
    ]);
    const out = loadCollectionItems(saved);
    // falls back to newUsed's own default visibility (false)
    expect(out.find(c => c.key === "newUsed").visible).toBe(false);
  });

  it("drops unknown keys that are no longer in defaults", () => {
    const saved = JSON.stringify([
      { key: "qty",   type: "card", label: "Total Sets", visible: true, width: "auto", collapsed: false },
      { key: "bogus", type: "card", label: "Ghost",      visible: true, width: "auto", collapsed: false },
    ]);
    const out = loadCollectionItems(saved);
    expect(out.map(c => c.key)).not.toContain("bogus");
  });

  it("appends a newly-added default card that the saved config never had", () => {
    // a saved config with only one card → every other default is appended
    const saved = JSON.stringify([
      { key: "qty", type: "card", label: "Total Sets", visible: true, width: "auto", collapsed: false },
    ]);
    const out = loadCollectionItems(saved);
    const minifigs = out.find(c => c.key === "minifigs");
    expect(minifigs).toBeTruthy();
    expect(minifigs.visible).toBe(false); // default visibility for an appended card
  });

  it("throws on corrupt JSON (documented legacy behaviour, hardened in the override-map rework)", () => {
    expect(() => loadCollectionItems("{not json")).toThrow();
  });
});
