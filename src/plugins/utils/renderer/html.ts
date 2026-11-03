const domParser = new DOMParser();

/** Creates a DOM element from an HTML string. */
export const ElementFromHtml = (html: string): HTMLElement => {
  return (domParser.parseFromString(html, 'text/html') as HTMLDocument).body
    .firstElementChild as HTMLElement;
};
