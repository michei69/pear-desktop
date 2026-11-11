import { afterEach, describe, expect, test, vi } from "vitest";
import { observe } from "../src/dom.tsx";

/** A MutationObserver the tests drive by hand: one instance per watched node. */
class FakeObserver {
  static instances: FakeObserver[] = [];

  readonly callback: MutationCallback;
  target: Node | undefined;
  options: MutationObserverInit | undefined;
  disconnected = true;

  constructor(callback: MutationCallback) {
    this.callback = callback;
    FakeObserver.instances.push(this);
  }

  observe(target: Node, options: MutationObserverInit) {
    this.target = target;
    this.options = options;
    this.disconnected = false;
  }

  disconnect() {
    this.disconnected = true;
  }

  takeRecords(): MutationRecord[] {
    return [];
  }

  emit(records: MutationRecord[]) {
    this.callback(records, this as unknown as MutationObserver);
  }
}

const record = (type: MutationRecordType, target: Node, attributeName?: string) =>
  ({ type, target, attributeName }) as unknown as MutationRecord;

const start = () => {
  FakeObserver.instances = [];
  vi.stubGlobal("MutationObserver", FakeObserver as unknown as typeof MutationObserver);
};

afterEach(() => vi.unstubAllGlobals());

describe("the shared MutationObserver", () => {
  test("one observer per watched node, each watch seeing only its own records", () => {
    start();
    const target = {} as Node;
    const children = vi.fn();
    const classes = vi.fn();
    observe(target, { childList: true }, children);
    observe(target, { attributes: true, attributeFilter: ["class"] }, classes);

    // Both watches share one browser observer, widened to the union of their options.
    expect(FakeObserver.instances).toHaveLength(1);
    const observer = FakeObserver.instances[0]!;
    expect(observer.options).toMatchObject({ childList: true, attributes: true, subtree: false, attributeFilter: ["class"] });

    const childRecord = record("childList", target);
    const classRecord = record("attributes", target, "class");
    const titleRecord = record("attributes", target, "title");
    observer.emit([childRecord, classRecord, titleRecord]);

    expect(children).toHaveBeenCalledWith([childRecord], observer);
    expect(classes).toHaveBeenCalledWith([classRecord], observer);
  });

  test("subtree is per watch, not per observer", () => {
    start();
    const target = {} as Node;
    const descendant = {} as Node;
    const own = vi.fn();
    const deep = vi.fn();
    observe(target, { childList: true }, own);
    observe(target, { childList: true, subtree: true }, deep);

    const onDescendant = record("childList", descendant);
    FakeObserver.instances[0]!.emit([onDescendant]);

    expect(own).not.toHaveBeenCalled();
    expect(deep).toHaveBeenCalledWith([onDescendant], FakeObserver.instances[0]);
  });

  test("adding a covered watch keeps the same observation, so no batch is lost", () => {
    start();
    const target = {} as Node;
    observe(target, { childList: true }, vi.fn());
    const observer = FakeObserver.instances[0]!;
    const disconnect = vi.spyOn(observer, "disconnect");
    observe(target, { childList: true }, vi.fn());
    expect(disconnect).not.toHaveBeenCalled();
  });

  test("the last stop disconnects; the next watch creates a new observer", () => {
    start();
    const target = {} as Node;
    const stopA = observe(target, { childList: true }, vi.fn());
    const stopB = observe(target, { attributes: true }, vi.fn());
    const observer = FakeObserver.instances[0]!;
    expect(observer.options).toMatchObject({ childList: true, attributes: true });

    stopA();
    expect(observer.disconnected).toBe(false);
    stopB();
    expect(observer.disconnected).toBe(true);

    observe(target, { childList: true }, vi.fn());
    expect(FakeObserver.instances).toHaveLength(2);
  });
});
