/**
 * Shared MutationObservers for player-page nodes.
 *
 * Plugins that react to player-UI mutations (the player element being rebuilt,
 * `playback-mode` being flipped, the song menu opening, a new <video> being
 * attached) used to each own an observer on the same node. This registry keeps
 * one observer per watched root and dispatches every batch to the watches that
 * care about it, so N plugins cost one observer per shared root.
 *
 * Watches are matched by attribute name and by whether they asked for the
 * subtree, so a plugin only sees the mutations its own observer would have
 * reported. Each callback runs once per batch.
 */

export type PlayerPageWatch = {
  /** Attribute names on the watched element that matter to this watch. */
  attributes?: readonly string[];
  /** Watch childList changes. */
  childList?: boolean;
  /** Also watch descendants instead of only the watched element. */
  subtree?: boolean;
  /** Called once per batch with the mutations this watch matches. */
  callback: (mutations: MutationRecord[]) => void;
};

type WatchedRoot = {
  element: Element;
  observer: MutationObserver;
  watches: Set<PlayerPageWatch>;
};

const watchedRoots = new Map<string, WatchedRoot>();

const matches = (
  watch: PlayerPageWatch,
  mutation: MutationRecord,
  root: Element,
) => {
  if (!watch.subtree && mutation.target !== root) return false;

  if (mutation.type === 'attributes') {
    return watch.attributes?.includes(mutation.attributeName ?? '') === true;
  }

  return mutation.type === 'childList' && watch.childList === true;
};

/** Widens the root's observation to the union of what its watches need. */
const applyConfig = (root: WatchedRoot) => {
  let childList = false;
  let subtree = false;
  const attributes = new Set<string>();

  for (const watch of root.watches) {
    childList ||= watch.childList === true;
    subtree ||= watch.subtree === true;
    for (const attribute of watch.attributes ?? []) attributes.add(attribute);
  }

  root.observer.disconnect();
  root.observer.observe(root.element, {
    childList,
    subtree,
    attributes: attributes.size > 0,
    attributeFilter: attributes.size > 0 ? [...attributes] : undefined,
  });
};

const createRoot = (element: Element): WatchedRoot => {
  const watches = new Set<PlayerPageWatch>();
  const root: WatchedRoot = {
    element,
    watches,
    observer: new MutationObserver((mutations) => {
      for (const watch of watches) {
        const relevant = mutations.filter((mutation) =>
          matches(watch, mutation, root.element),
        );
        if (relevant.length > 0) watch.callback(relevant);
      }
    }),
  };

  return root;
};

/**
 * Subscribes to mutations on the first element matching `selector`. Returns an
 * unsubscribe function; when the last watch leaves, the observer disconnects.
 * A missing root is a no-op, so callers never need a null check.
 */
export const observePlayerPage = (
  selector: string,
  watch: PlayerPageWatch,
): (() => void) => {
  const element = document.querySelector(selector);
  if (!element) return () => {};

  // The app may replace the node (e.g. a player rebuild). Retarget the shared
  // observer instead of dropping the watches other plugins still hold.
  const root = watchedRoots.get(selector) ?? createRoot(element);
  root.element = element;
  watchedRoots.set(selector, root);

  root.watches.add(watch);
  applyConfig(root);

  return () => {
    if (!root.watches.delete(watch) || root.watches.size > 0) return;

    root.observer.disconnect();
    if (watchedRoots.get(selector) === root) watchedRoots.delete(selector);
  };
};
