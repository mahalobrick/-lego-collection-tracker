import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { useState } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import Icon, { ICON_NAMES } from "./Icon";

// ─────────────────────────────────────────────────────────────────────────────
// Icon is memo()'d (cold-click-race fix): the parent's per-mousemove setTipPos re-render storm
// must NOT re-invoke Icon and re-inject its dangerouslySetInnerHTML <svg> mid-click. These pin:
//   • it still renders the right SVG with the injected size,
//   • memo's shallow compare STILL re-renders on a genuine name/size change (no dropped updates),
//   • a parent re-render with UNCHANGED props leaves the <svg> DOM node IN PLACE (the regression
//     guard: that node swap is exactly what broke a cold click straddling a re-render).
// ─────────────────────────────────────────────────────────────────────────────

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container, root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const render = (el) => act(() => root.render(el));
const svg = () => container.querySelector("svg");
const iconHtml = () => container.querySelector("span")?.innerHTML ?? null;

describe("Icon — memo (cold-click-race fix)", () => {
  it("renders the requested icon with the injected pixel size", () => {
    render(<Icon name="eye" size={16} />);
    const s = svg();
    expect(s, "an <svg> is injected").toBeTruthy();
    expect(s.getAttribute("width")).toBe("16");
    expect(s.getAttribute("height")).toBe("16");
  });

  it("re-renders when NAME changes (memo compares props — no dropped update)", () => {
    expect(ICON_NAMES).toEqual(expect.arrayContaining(["eye", "edit"]));
    render(<Icon name="eye" size={16} />);
    const eyeHtml = iconHtml();
    render(<Icon name="edit" size={16} />);
    const editHtml = iconHtml();
    expect(eyeHtml).toBeTruthy();
    expect(editHtml).toBeTruthy();
    expect(editHtml, "a different name swaps to a different svg").not.toBe(eyeHtml);
  });

  it("re-renders when SIZE changes (memo compares props — no dropped update)", () => {
    render(<Icon name="eye" size={16} />);
    expect(svg().getAttribute("width")).toBe("16");
    render(<Icon name="eye" size={24} />);
    expect(svg().getAttribute("width")).toBe("24");
    expect(svg().getAttribute("height")).toBe("24");
  });

  it("REGRESSION: a parent re-render with unchanged props leaves the <svg> node in place (no re-injection)", () => {
    let bump;
    function Harness() {
      const [n, setN] = useState(0);
      bump = () => setN((v) => v + 1);
      // Icon props are constant across the parent's state change — memo must skip its render.
      return <div data-bump={n}><Icon name="eye" size={16} /></div>;
    }
    render(<Harness />);
    const before = svg();
    expect(before).toBeTruthy();
    act(() => bump());            // parent re-renders; Icon props identical
    const after = svg();
    expect(after, "the SAME <svg> node object persists (memo skipped Icon, no innerHTML re-inject)").toBe(before);
  });

  it("unknown name renders nothing (no crash)", () => {
    render(<Icon name="__does_not_exist__" size={16} />);
    expect(svg()).toBeNull();
  });
});
