// The types the `@pear/sdk` JSX transform works with. They live in a
// declaration file so the `JSX` namespace is types only, as the transform
// looks it up on this module (`jsx-runtime.ts` re-exports it).

export type Child = Node | string | number | boolean | null | undefined | readonly Child[];

type Elements = HTMLElementTagNameMap & Omit<SVGElementTagNameMap, keyof HTMLElementTagNameMap>;

type Listeners<E> = {
  [K in keyof HTMLElementEventMap as `on${Capitalize<K>}`]?: (event: HTMLElementEventMap[K] & { currentTarget: E }) => void;
};

/** Properties worth setting from JSX (the rest are attributes). */
type PropertyName =
  | "id" | "title" | "hidden" | "inert" | "tabIndex" | "textContent" | "dir" | "lang" | "draggable"
  | "type" | "name" | "value" | "checked" | "disabled" | "placeholder" | "min" | "max" | "step"
  | "popover" | "popoverTargetElement" | "popoverTargetAction"
  | "src" | "alt" | "href" | "target" | "width" | "height" | "loading" | "decoding" | "crossOrigin" | "dateTime";

type Props<E> = Listeners<E> &
  Partial<Pick<E, PropertyName & keyof E>> & {
    class?: string | undefined;
    style?: string | Record<string, string | number> | undefined;
    ref?: ((element: E) => void) | undefined;
    children?: Child;
    [attribute: string]: unknown;
  };

export declare namespace JSX {
  /** What every JSX expression gives: a real element (SVG ones included; cast if you need their own API). */
  type Element = HTMLElement;
  type IntrinsicElements = { [K in keyof Elements]: Props<Elements[K]> };
  interface ElementChildrenAttribute {
    children: {};
  }
}
