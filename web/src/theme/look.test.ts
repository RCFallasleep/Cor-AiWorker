import { describe, expect, it } from "vitest";

import { DEFAULT_LOOK, applyLook, parseLook } from "./look";

describe("parseLook", () => {
  it("keeps valid values and replaces invalid ones with defaults", () => {
    expect(parseLook('{"mode":"dark","skin":"teal"}')).toEqual({ mode: "dark", skin: "teal" });
    expect(parseLook('{"mode":"neon","skin":"unknown"}')).toEqual(DEFAULT_LOOK);
    expect(parseLook("not json")).toEqual(DEFAULT_LOOK);
    expect(parseLook(null)).toEqual(DEFAULT_LOOK);
  });
});

describe("applyLook", () => {
  function fakeRoot() {
    const attrs = new Map<string, string>();
    const root = {
      setAttribute: (name: string, value: string) => void attrs.set(name, value),
      removeAttribute: (name: string) => void attrs.delete(name),
    };
    return { attrs, root: root as unknown as HTMLElement };
  }

  it("sets attributes only for non-default choices", () => {
    const { attrs, root } = fakeRoot();
    applyLook({ mode: "dark", skin: "ink" }, root);
    expect(Object.fromEntries(attrs)).toEqual({ "data-theme": "dark", "data-skin": "ink" });

    applyLook(DEFAULT_LOOK, root);
    expect(attrs.size).toBe(0);
  });
});
