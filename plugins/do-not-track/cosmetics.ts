// The blocklists' cosmetic filters, applied in the page.

import type { Ctx } from "./schema.ts";

const COSMETICS_RETRY_MS = 1000;
/** Coalesce a batch of DOM changes into one host call. */
const BATCH_MS = 200;

/**
 * Applies the lists' cosmetic filters to the page, as Ghostery's preload does:
 * the page's base and hostname rules, then the rules for the classes, ids and
 * links that appear later. Only the elements a mutation added or changed are
 * inspected, like pear-desktop's preload, so a busy page costs no whole-DOM walks.
 */
export function applyCosmetics(ctx: Ctx) {
  const style = ctx.addStyle("");
  let css = "";
  const add = (styles: string) => {
    if (!styles) return;
    css += `\n${styles}`;
    style.update(css);
  };
  const runScriptlets = async (scripts: string[]) => {
    // The page's CSP is lifted: a blob module runs in the main world.
    for (const script of scripts) {
      const url = URL.createObjectURL(new Blob([script], { type: "text/javascript" }));
      await import(/* @vite-ignore */ url).catch((error: unknown) => ctx.log.warn("scriptlet failed", error));
      URL.revokeObjectURL(url);
    }
  };

  const seen = { classes: new Set<string>(), ids: new Set<string>(), hrefs: new Set<string>() };
  const batch = { classes: [] as string[], ids: [] as string[], hrefs: [] as string[] };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    timer = undefined;
    if (ctx.signal.aborted || !(batch.classes.length || batch.ids.length || batch.hrefs.length)) return;
    const request = { url: location.href, base: false, ...batch };
    batch.classes = [];
    batch.ids = [];
    batch.hrefs = [];
    ctx.host.invoke("cosmetics", request).then(
      (result) => result && add(result.styles),
      () => {},
    );
  };
  const schedule = () => {
    timer ??= ctx.setTimeout(flush, BATCH_MS);
  };
  /** Collects the element's unseen features; true when anything was new. */
  const collect = (element: Element) => {
    let fresh = false;
    for (const name of element.classList) fresh = addFeature(name, seen.classes, batch.classes) || fresh;
    fresh = addFeature(element.id, seen.ids, batch.ids) || fresh;
    if (element instanceof HTMLAnchorElement) fresh = addFeature(element.href, seen.hrefs, batch.hrefs) || fresh;
    return fresh;
  };
  const collectTree = (node: Element) => {
    let fresh = collect(node);
    for (const element of node.querySelectorAll("[class],[id],a[href]")) fresh = collect(element) || fresh;
    return fresh;
  };
  const observer = new MutationObserver((mutations) => {
    let fresh = false;
    for (const mutation of mutations) {
      if (mutation.type === "attributes") {
        if (mutation.target instanceof Element) fresh = collect(mutation.target) || fresh;
        continue;
      }
      for (const node of mutation.addedNodes) {
        if (node instanceof Element) fresh = collectTree(node) || fresh;
      }
    }
    if (fresh) schedule();
  });
  ctx.onCleanup(() => observer.disconnect());

  // The lists load in the host after startup; ask until they're there.
  const base = () => {
    if (ctx.signal.aborted) return;
    ctx.host.invoke("cosmetics", { url: location.href, base: true }).then(
      (result) => {
        if (ctx.signal.aborted) return;
        if (!result) {
          ctx.setTimeout(base, COSMETICS_RETRY_MS);
          return;
        }
        add(result.styles);
        void runScriptlets(result.scripts);
        observer.observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "id", "href"] });
        // What the page rendered before the lists loaded was never seen by the
        // observer; one walk covers it, later changes are collected incrementally.
        scanPage();
      },
      () => ctx.setTimeout(base, COSMETICS_RETRY_MS),
    );
  };
  const scanPage = () => {
    if (ctx.signal.aborted) return;
    // Starting before YTM's scripts: the document can still be empty.
    if (!document.documentElement) {
      ctx.setTimeout(scanPage, COSMETICS_RETRY_MS);
      return;
    }
    let fresh = false;
    for (const element of document.querySelectorAll("[class],[id],a[href]")) fresh = collect(element) || fresh;
    if (fresh) schedule();
  };
  base();
}

/** Adds `value` to `fresh` the first time it is seen. */
function addFeature(value: string, seen: Set<string>, fresh: string[]) {
  if (!value || seen.has(value)) return false;
  seen.add(value);
  fresh.push(value);
  return true;
}
