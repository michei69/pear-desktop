import type { HostEnvironment } from "../src/main/plugins.ts";
import { MenuItems } from "../src/main/menu-items.ts";

export function fakeHostEnvironment(overrides: Partial<HostEnvironment> = {}): HostEnvironment {
  return {
    app: {} as never,
    window: {} as never,
    session: {} as never,
    router: { scoped: () => ({}), scopedSession: () => ({}), release() {} } as never,
    player: { state: {}, on: () => () => {}, control() {} } as never,
    requests: {} as never,
    send() {},
    openSettings() {},
    focusWindow() {},
    menuItems: new MenuItems(),
    broadcast() {},
    onProtocol: () => () => {},
    onDisabled() {},
    ...overrides,
  };
}
