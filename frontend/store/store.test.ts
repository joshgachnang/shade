import {describe, expect, test} from "bun:test";

describe("store", () => {
  test("store exports correctly", async () => {
    const store = await import("./index");
    expect(store.default).toBeDefined();
    expect(store.persistor).toBeDefined();
    expect(store.useAppDispatch).toBeDefined();
  });
});
