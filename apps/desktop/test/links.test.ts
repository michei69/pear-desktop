import { YTM_ORIGIN } from "@pear/sdk/util";
import { describe, expect, test } from "vitest";
import { navigationAction, windowOpenAction } from "../src/main/links.ts";

const VIDEO_SITE = new URL(YTM_ORIGIN).hostname.replace(/^music\./, "");

describe("windowOpenAction", () => {
  test.each([
    [`${YTM_ORIGIN}/playlist?list=1`, "load"],
    ["https://example.com/", "external"],
    ["http://example.com/", "external"],
    [`https://www.${VIDEO_SITE}/watch?v=1`, "popup"],
    // Sign-in popups start blank; Google pages stay in the app.
    ["https://accounts.google.com/", "popup"],
    ["mailto:a@b.c", "external"],
    ["tel:+123", "external"],
    ["about:blank", "popup"],
    [`http://www.${VIDEO_SITE}/watch?v=1`, "external"],
    ["file:///etc/hosts", "deny"],
    ["javascript:alert(1)", "deny"],
    ["pear://settings/", "deny"],
    ["not a url", "deny"],
  ])("%s → %s", (url, expected) => {
    expect(windowOpenAction(url)).toBe(expected);
  });
});

describe("navigationAction", () => {
  test.each([
    [`${YTM_ORIGIN}/watch?v=1`, "allow"],
    ["https://accounts.google.com/ServiceLogin?continue=x", "allow"],
    [`https://accounts.${VIDEO_SITE}/accounts/SetSID`, "allow"],
    [`https://www.${VIDEO_SITE}/signin?next=${encodeURIComponent(YTM_ORIGIN)}`, "allow"],
    [`https://www.${VIDEO_SITE}/logout`, "allow"],
    [`https://consent.${VIDEO_SITE}/save`, "allow"],
    ["https://consent.google.com/save", "allow"],
    ["https://gds.google.com/web/chip", "allow"],
    [`https://www.${VIDEO_SITE}/watch?v=1`, "allow"],
    ["https://support.google.com/accounts", "allow"],
    ["https://accounts.google.com.evil.com/", "external"],
    [`http://music.${VIDEO_SITE}/`, "external"],
    ["https://example.com/", "external"],
    ["file:///etc/hosts", "deny"],
    ["mailto:a@b.c", "external"],
    ["tel:+123", "external"],
    ["pear://settings/", "deny"],
  ])("%s → %s", (url, expected) => {
    expect(navigationAction(url)).toBe(expected);
  });
});
