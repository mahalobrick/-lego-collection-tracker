// MSRP is read from bricksetSetCache → entry.data.retail_price_us (Brickset canonical, via the
// figure→base→-0→-1 walk of bricksetRetailEntry), with the collection item's manual `msrp` as the
// secondary rung — exactly retailFor()/setRetailProvenance (BrickEconomy was removed from retail in Phase 3c).
//
// BrickLedger — collection coverage-count query. READ-ONLY: reads localStorage only, no writes, no
// network. Paste into the app's DevTools console (on the running app, signed in). Cache keys + field
// names mirror the source (MyCollection.jsx hydration, brickset.js bricksetRetailEntry, valueCache.js,
// beSyncValues.js).
(() => {
  // ── localStorage reads (the real keys) ──────────────────────────────────────
  const parse = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || d); } catch { return JSON.parse(d); } };
  const bsCache = parse("bricksetSetCache", "{}");      // { [brickset_<n>]: { data, fetchedAt } }
  const blVal   = parse("blValueCache", "{}");          // { [setNumber]: { record:{new,used}, fetchedAt } }
  const beCache = parse("brickEconomySetCache", "{}");  // { [<n minus -1>]: { data, fetchedAt } }

  // Collection store: BE-synced normalized blob + manually-added sets (excludes stale BE rows),
  // merged exactly as MyCollection does (BE rows + manual rows can coexist).
  const beItems = parse("brickEconomyNormalizedCollection", "[]");
  const manual  = parse("blOwnedSets", "[]").filter(m => m && m.source !== "BrickEconomy");
  const sets = [...beItems, ...manual];

  // ── helpers (number-normalization + key derivation, per source) ─────────────
  const num     = (v) => { const n = parseFloat(String(v ?? "").replace(/[^0-9.\-]/g, "")); return isFinite(n) ? n : 0; };
  const stripV1 = (n) => String(n ?? "").replace(/-1$/, "");      // MC minifig/record lookup (-1 de-variant)
  const baseN   = (n) => String(n ?? "").replace(/-\d+$/, "");    // bricksetRetailEntry base (any -N)

  // Brickset record entry for a set (MyCollection.jsx:182 lookup order).
  const bsEntry = (sn) => bsCache[`brickset_${sn}`] || bsCache[`brickset_${stripV1(sn)}`] || null;

  // Brickset MSRP via the bricksetRetailEntry walk (brickset.js:75-82): first candidate with retail_price_us > 0.
  const bsRetail = (sn) => {
    const base = baseN(sn);
    const hit = [`brickset_${sn}`, `brickset_${base}`, `brickset_${base}-0`, `brickset_${base}-1`]
      .map((k) => bsCache[k])
      .find((e) => num(e?.data?.retail_price_us) > 0);
    return hit ? num(hit.data.retail_price_us) : 0;
  };

  // BrickEconomy cache entry (MyCollection.jsx:183 lookup order).
  const beData = (sn) => beCache[stripV1(sn)]?.data || beCache[sn]?.data || null;

  // ── per-set coverage flags ──────────────────────────────────────────────────
  let total = 0, bsRecord = 0, minifig = 0, msrp = 0, blValue = 0, beValue = 0;
  let noMsrpHasBs = 0, noMsrpNoBs = 0; // genuine vs fetch-gap, among sets WITHOUT an MSRP

  for (const s of sets) {
    const sn = s.setNumber;
    if (sn == null || sn === "") continue;
    total++;

    const entry = bsEntry(sn);
    const hasBsRecord = !!(entry && entry.data);
    if (hasBsRecord) bsRecord++;

    // minifig data: entries[0].minifigs_count ?? Brickset data.minifigs ?? BE data.minifigs_count (MC:184)
    const mf = s.entries?.[0]?.minifigs_count ?? entry?.data?.minifigs ?? beData(sn)?.minifigs_count ?? s.minifigs ?? null;
    if (mf != null) minifig++;

    // MSRP: Brickset retail_price_us (canonical) OR manual msrp rung (retailFor/setRetailProvenance)
    const hasMsrp = bsRetail(sn) > 0 || num(s.msrp) > 0;
    if (hasMsrp) msrp++;
    else if (hasBsRecord) noMsrpHasBs++; // Brickset record exists but lists no retail → genuine
    else noMsrpNoBs++;                   // no Brickset record → not-yet-enriched / fetch gap

    // BL value: blValueCache[setNumber].record has a numeric new/used amount
    const rec = blVal[String(sn).trim()]?.record;
    if (rec && (num(rec.new?.amount) > 0 || num(rec.used?.amount) > 0)) blValue++;

    // BE value: brickEconomySetCache data has current_value_new/current_value_used
    const bd = beData(sn);
    if (bd && (num(bd.current_value_new) > 0 || num(bd.current_value_used) > 0)) beValue++;
  }

  const pct = (n) => total ? `${((n / total) * 100).toFixed(1)}%` : "—";

  console.log("%cBrickLedger coverage", "font-weight:bold;font-size:14px");
  console.table({
    "total sets in collection": { count: total, "% of total": "100%" },
    "Brickset record present":  { count: bsRecord, "% of total": pct(bsRecord) },
    "minifig data present":     { count: minifig,  "% of total": pct(minifig) },
    "MSRP present":             { count: msrp,     "% of total": pct(msrp) },
    "BL value present":         { count: blValue,  "% of total": pct(blValue) },
    "BE value present":         { count: beValue,  "% of total": pct(beValue) },
  });

  const noMsrp = total - msrp;
  console.log(`%cMSRP gap analysis — of ${noMsrp} sets WITHOUT an MSRP:`, "font-weight:bold");
  console.table({
    "genuine (has Brickset record, no retail listed)": { count: noMsrpHasBs, "% of no-MSRP": noMsrp ? `${((noMsrpHasBs / noMsrp) * 100).toFixed(1)}%` : "—" },
    "fetch gap (no Brickset record yet)":              { count: noMsrpNoBs,  "% of no-MSRP": noMsrp ? `${((noMsrpNoBs / noMsrp) * 100).toFixed(1)}%` : "—" },
  });

  return { total, bsRecord, minifig, msrp, blValue, beValue, noMsrp, noMsrpHasBs, noMsrpNoBs };
})();
