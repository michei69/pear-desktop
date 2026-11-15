import { describe, expect, test, vi } from "vitest";
import type { Session } from "electron";
import { ALLOWED_PERMISSIONS, hardenSession } from "../src/main/permissions.ts";

function fakeSession() {
  let request: ((contents: unknown, permission: string, callback: (allowed: boolean) => void) => void) | undefined;
  let check: ((contents: unknown, permission: string) => boolean) | undefined;
  const session = {
    setPermissionRequestHandler: vi.fn((handler) => {
      request = handler;
    }),
    setPermissionCheckHandler: vi.fn((handler) => {
      check = handler;
    }),
    setSpellCheckerEnabled: vi.fn(),
  } as unknown as Session;
  return {
    session,
    ask: (permission: string) => {
      let allowed = false;
      request?.(null, permission, (value) => {
        allowed = value;
      });
      return allowed;
    },
    check: (permission: string) => check?.(null, permission),
  };
}

describe("hardenSession", () => {
  test("allows only the permissions the app needs", () => {
    const fake = fakeSession();
    hardenSession(fake.session);
    for (const permission of Object.keys(ALLOWED_PERMISSIONS)) {
      expect(fake.ask(permission)).toBe(true);
      expect(fake.check(permission)).toBe(true);
    }
    for (const permission of ["notifications", "geolocation", "midi", "openExternal"]) {
      expect(fake.ask(permission)).toBe(false);
      expect(fake.check(permission)).toBe(false);
    }
    expect(fake.session.setSpellCheckerEnabled).toHaveBeenCalledWith(false);
  });
});
