import { expect, test } from "vitest";
import { CONTEXT_MENU_ENTRIES, hideMenuEntries, menuEntryKeyOf, type MenuItemData } from "../src/context-menu.ts";

const download = (): MenuItemData => ({ menuServiceItemDownloadRenderer: {} });
const toggle = (icon: string, endpoints: Record<string, unknown> = {}): MenuItemData => ({
  toggleMenuServiceItemRenderer: {
    icon: { iconType: icon },
    serviceEndpoint: endpoints,
  },
});
const service = (endpoints: Record<string, unknown>): MenuItemData => ({
  menuServiceItemRenderer: { serviceEndpoint: endpoints },
});

test("matches the dedicated download renderer", () => {
  expect(menuEntryKeyOf(download())).toBe("download");
});

test("matches a like toggle by its icon or its endpoint", () => {
  expect(menuEntryKeyOf(toggle("FAVORITE"))).toBe("like");
  expect(menuEntryKeyOf(toggle("UNFAVORITE", { likeEndpoint: {} }))).toBe("like");
  // A toggle with another icon is another action (and not a like).
  expect(menuEntryKeyOf(toggle("BOOKMARK"))).toBe("save-to-library");
});

test("matches queue entries by insertion position, not order of the endpoints", () => {
  expect(menuEntryKeyOf(service({ queueAddEndpoint: { queueInsertPosition: "INSERT_AFTER_CURRENT_VIDEO" } }))).toBe("play-next");
  expect(menuEntryKeyOf(service({ queueAddEndpoint: { queueInsertPosition: "INSERT_AT_END" } }))).toBe("add-to-queue");
  expect(menuEntryKeyOf(service({ queueAddEndpoint: { queueInsertPosition: "SOMETHING_NEW" } }))).toBeNull();
});

test("matches share and report from their endpoints on any endpoint field", () => {
  expect(menuEntryKeyOf(service({ shareEntityEndpoint: {} }))).toBe("share");
  expect(menuEntryKeyOf(service({ shareEndpoint: {} }))).toBe("share");
  expect(menuEntryKeyOf(service({ flagEndpoint: {} }))).toBe("report");
  expect(menuEntryKeyOf(service({ getReportFormEndpoint: {} }))).toBe("report");
});

test("more specific entries win over the general ones", () => {
  // The queue's Dismiss queue shares deletePlaylistEndpoint with a real playlist delete.
  expect(menuEntryKeyOf(toggle("DISMISS_QUEUE", { deletePlaylistEndpoint: {} }))).toBe("dismiss-queue");
  expect(menuEntryKeyOf(toggle("DELETE", { deletePlaylistEndpoint: {} }))).toBe("delete-playlist");
  // Signed out, YTM wraps Save to playlist in a sign-in modal; the icon still says what it does.
  expect(menuEntryKeyOf(toggle("ADD_TO_PLAYLIST", { modalEndpoint: {} }))).toBe("save-to-playlist");
  // Pin to listen again and Not interested are both feedback toggles.
  expect(menuEntryKeyOf(toggle("KEEP", { feedbackEndpoint: {} }))).toBe("pin-to-listen-again");
  expect(menuEntryKeyOf(toggle("NOT_INTERESTED", { feedbackEndpoint: {} }))).toBe("not-interested");
});

test("an entry Music adds later matches nothing and stays visible", () => {
  const unknown: MenuItemData = { menuNavigationItemRenderer: { text: { runs: [{ text: "Something new" }] } } };
  expect(menuEntryKeyOf(unknown)).toBeNull();
  expect(hideMenuEntries([unknown], ["share"])).toEqual([unknown]);
});

test("hideMenuEntries removes the hidden keys and keeps the rest in order", () => {
  const like = toggle("FAVORITE");
  const share = service({ shareEntityEndpoint: {} });
  const unknown: MenuItemData = { menuServiceItemRenderer: {} };
  expect(hideMenuEntries([download(), like, share, unknown], ["like", "share"])).toEqual([download(), unknown]);
  // Nothing hidden: a copy, not the same array.
  const items = [like, share];
  const kept = hideMenuEntries(items, []);
  expect(kept).toEqual(items);
  expect(kept).not.toBe(items);
});

test("every entry has a unique key and the contextMenu<Entry> config key", () => {
  const keys = CONTEXT_MENU_ENTRIES.map((entry) => entry.key);
  const configKeys = CONTEXT_MENU_ENTRIES.map((entry) => entry.configKey);
  expect(new Set(keys).size).toBe(keys.length);
  expect(new Set(configKeys).size).toBe(configKeys.length);
  for (const entry of CONTEXT_MENU_ENTRIES) {
    expect(entry.configKey).toMatch(/^contextMenu[A-Z]/);
    expect(entry.label.length).toBeGreaterThan(0);
  }
  expect(CONTEXT_MENU_ENTRIES.find((entry) => entry.key === "play-next")?.configKey).toBe("contextMenuPlayNext");
  expect(CONTEXT_MENU_ENTRIES.find((entry) => entry.key === "stats-for-nerds")?.configKey).toBe("contextMenuStatsForNerds");
});
