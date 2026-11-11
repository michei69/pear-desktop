import { describe, expect, test } from "vitest";
import { closedDuringBatch, OPEN_CLASS, toastsClosedDuringBatch } from "../batch.ts";

const open = (name: string) => ({ name, isOpen: true });
const isOpen = (toast: { isOpen: boolean }) => toast.isOpen;

describe("toast batch disarm", () => {
  // pear-desktop d0e31b13's ordering tests, on the pure walk they guard.

  test("a toast that closes and reopens in one batch counts as closed", () => {
    // remove the open class (was open), then add it back (was closed).
    expect(closedDuringBatch(true, [OPEN_CLASS, ""])).toBe(true);
    expect(
      toastsClosedDuringBatch(
        [
          { toast: "reused", oldValue: OPEN_CLASS },
          { toast: "reused", oldValue: "" },
        ],
        () => true,
      ),
    ).toEqual(["reused"]);
  });

  test("an open toast whose unrelated class changed keeps its deadline", () => {
    // The class attribute was open before the extra class was added.
    expect(closedDuringBatch(true, [`${OPEN_CLASS} some-other-class`])).toBe(false);
    expect(toastsClosedDuringBatch([{ toast: "open", oldValue: `${OPEN_CLASS} some-other-class` }], () => true)).toEqual([]);
  });

  test("a toast that only closed counts as closed", () => {
    expect(closedDuringBatch(false, [OPEN_CLASS])).toBe(true);
    expect(closedDuringBatch(false, ["", OPEN_CLASS])).toBe(true);
  });

  test("a second toast neither extends nor re-arms the first one", () => {
    const first = open("first");
    const second = open("second");
    // The first was reused (close + reopen); the second is a fresh, unrelated toast.
    expect(
      toastsClosedDuringBatch(
        [
          { toast: first, oldValue: OPEN_CLASS },
          { toast: first, oldValue: "" },
          { toast: second, oldValue: "" },
        ],
        isOpen,
      ),
    ).toEqual([first]);
  });

  test("the changes of two toasts in one batch stay separate", () => {
    const first = open("first");
    const second = open("second");
    expect(
      toastsClosedDuringBatch(
        [
          { toast: first, oldValue: "" },
          { toast: second, oldValue: "" },
          { toast: first, oldValue: OPEN_CLASS },
        ],
        isOpen,
      ),
    ).toEqual([]);
  });
});
