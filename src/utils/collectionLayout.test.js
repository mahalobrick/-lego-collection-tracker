import { describe, it, expect } from "vitest";
import {
  DEFAULT_COLLECTION_ITEMS, loadCollectionItems,
  CARD_DEFS, CARD_TIERS, CARD_GROUPS, cardVisible, loadCardOverrides, toggleCardOverride,
  gearCardRowsByTier, tieredVisibleCards,
} from "./collectionLayout";

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

describe("CARD_DEFS / CARD_TIERS — registry integrity", () => {
  it("CARD_DEFS keys exactly match the DEFAULT card keys (registry + defs can't drift)", () => {
    const cardKeys = DEFAULT_COLLECTION_ITEMS.filter(c => c.type === "card").map(c => c.key).sort();
    expect(Object.keys(CARD_DEFS).sort()).toEqual(cardKeys);
  });

  it("every CARD_DEF is assigned to exactly one tier", () => {
    const defKeys = Object.keys(CARD_DEFS).sort();
    const tierKeys = CARD_TIERS.flatMap(t => t.keys).sort();
    expect(tierKeys).toEqual(defKeys);                       // exact coverage, no extras/missing
    expect(new Set(tierKeys).size).toBe(tierKeys.length);    // no key in two tiers
  });

  it("hero tier is value / gain / roi, unlabelled", () => {
    const hero = CARD_TIERS.find(t => t.id === "hero");
    expect(hero.keys).toEqual(["value", "gain", "roi"]);
    expect(hero.label).toBeNull();
  });

  it("defaults to opt-out — only the partition group + Wanted List start hidden", () => {
    const off = Object.entries(CARD_DEFS).filter(([, d]) => !d.defaultVisible).map(([k]) => k).sort();
    expect(off).toEqual(["newValue", "usedValue", "watchList"]);
  });
});

describe("cardVisible() — override ?? defaultVisible", () => {
  it("falls back to the card default when there is no override", () => {
    expect(cardVisible("value", {})).toBe(true);       // default-on
    expect(cardVisible("watchList", {})).toBe(false);  // default-off deviation
  });

  it("honours an explicit override either way", () => {
    expect(cardVisible("watchList", { watchList: true })).toBe(true);  // opt a default-off card IN
    expect(cardVisible("value", { value: false })).toBe(false);        // opt a default-on card OUT
  });

  it("unknown card key → not visible", () => {
    expect(cardVisible("nope", {})).toBe(false);
  });
});

describe("loadCardOverrides() — defensive parse", () => {
  it("returns {} for null / corrupt / non-object", () => {
    expect(loadCardOverrides(null)).toEqual({});
    expect(loadCardOverrides("{bad")).toEqual({});
    expect(loadCardOverrides("[1,2]")).toEqual({});
    expect(loadCardOverrides('"x"')).toEqual({});
  });

  it("keeps only known card keys with boolean values", () => {
    const raw = JSON.stringify({ value: false, watchList: true, ghost: true, qty: "yes" });
    expect(loadCardOverrides(raw)).toEqual({ value: false, watchList: true });
  });
});

describe("toggleCardOverride()", () => {
  it("writes the opposite of current effective visibility", () => {
    expect(toggleCardOverride({}, "value")).toEqual({ value: false });        // default-on → off
    expect(toggleCardOverride({}, "watchList")).toEqual({ watchList: true }); // default-off → on
    expect(toggleCardOverride({ value: false }, "value")).toEqual({ value: true }); // existing flips
  });

  it("does not mutate the input map", () => {
    const o = { value: false };
    toggleCardOverride(o, "qty");
    expect(o).toEqual({ value: false });
  });
});

describe("tieredVisibleCards(overrides)", () => {
  it("uses defaults when overrides is empty (partition group + Wanted List hidden)", () => {
    const byId = Object.fromEntries(tieredVisibleCards({}).map(t => [t.id, t.keys]));
    expect(byId.hero).toEqual(["value", "gain", "roi"]);
    expect(byId.composition).toEqual(["qty", "themes", "duplicates", "newUsed", "retired", "pieces", "minifigs"]); // watchList off
    expect(byId.valueCondition).toEqual(["cost", "retailValue", "avgValue", "avgPaid"]);                          // partition off
  });

  it("an override can hide a default-on card and show default-off cards", () => {
    const byId = Object.fromEntries(
      tieredVisibleCards({ value: false, watchList: true, newValue: true, usedValue: true }).map(t => [t.id, t.keys])
    );
    expect(byId.hero).toEqual(["gain", "roi"]);            // value hidden, tier order preserved
    expect(byId.composition).toContain("watchList");      // Wanted opted in
    expect(byId.valueCondition).toEqual(["cost", "retailValue", "avgValue", "avgPaid", "newValue", "usedValue"]);
  });

  it("drops a tier whose every card is hidden", () => {
    const tiers = tieredVisibleCards({ value: false, gain: false, roi: false });
    expect(tiers.map(t => t.id)).not.toContain("hero");
  });
});

describe("partition group — New/Used travel all-or-none", () => {
  const PART = ["newValue", "usedValue"];

  it("is the New/Used value group", () => {
    expect(CARD_GROUPS.partition.keys).toEqual(PART);
  });

  it("both default OFF and move together via the canonical key", () => {
    expect(PART.map(k => cardVisible(k, {}))).toEqual([false, false]);
    const on = toggleCardOverride({}, "usedValue");      // toggled via the NON-canonical member
    expect(on).toEqual({ newValue: true });              // stored under the canonical key only
    expect(PART.map(k => cardVisible(k, on))).toEqual([true, true]);
  });

  it("a stray partial override can never split the group (canonical decides)", () => {
    expect(PART.map(k => cardVisible(k, { usedValue: true }))).toEqual([false, false]);            // mirrored-only → all hidden
    expect(PART.map(k => cardVisible(k, { newValue: true, usedValue: false }))).toEqual([true, true]); // canonical wins
  });

  it("tieredVisibleCards renders both or none, never a partial partition", () => {
    const shown = (ov) => {
      const vc = tieredVisibleCards(ov).find(t => t.id === "valueCondition")?.keys || [];
      return PART.filter(k => vc.includes(k));
    };
    expect(shown({})).toEqual([]);                  // none by default
    expect(shown({ newValue: true })).toEqual(PART); // both when the group is on
    expect(shown({ usedValue: true })).toEqual([]);  // stray mirrored member → still none
  });

  it("loadCardOverrides strips mirrored members, keeping only the canonical key", () => {
    const raw = JSON.stringify({ newValue: true, usedValue: true, value: false });
    expect(loadCardOverrides(raw)).toEqual({ newValue: true, value: false });
  });

  it("the gear collapses the partition into ONE row in the valueCondition tier", () => {
    const vc = gearCardRowsByTier().find(t => t.id === "valueCondition");
    const partRows = vc.rows.filter(r => PART.includes(r.key));
    expect(partRows).toEqual([{ key: "newValue", label: "New / Used value" }]);
    expect(vc.rows.some(r => r.key === "usedValue")).toBe(false);
  });
});

describe("gearCardRowsByTier() — gear grouped by tier (on/off within fixed tiers)", () => {
  it("mirrors the panel tiers in order, hero labelled 'Headline'", () => {
    const tiers = gearCardRowsByTier();
    expect(tiers.map(t => t.id)).toEqual(["hero", "composition", "valueCondition"]);
    expect(tiers.find(t => t.id === "hero").label).toBe("Headline");
    expect(tiers.find(t => t.id === "composition").label).toBe("Composition");
    expect(tiers.find(t => t.id === "valueCondition").label).toBe("Value & condition");
  });

  it("hero rows are value / gain / roi, in order", () => {
    const hero = gearCardRowsByTier().find(t => t.id === "hero");
    expect(hero.rows.map(r => r.key)).toEqual(["value", "gain", "roi"]);
  });

  it("total rows = 16 (17 cards − 2 partition members + 1 group row) with no mirrored keys", () => {
    const keys = gearCardRowsByTier().flatMap(t => t.rows.map(r => r.key));
    expect(keys).toHaveLength(16);
    expect(keys).not.toContain("usedValue");
    expect(keys).not.toContain("mixedValue");
  });
});
