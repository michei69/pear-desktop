const domParser = new DOMParser();

/** Creates a DOM element from an HTML string. */
export const ElementFromHtml = (html: string): HTMLElement => {
  return (domParser.parseFromString(html, 'text/html') as HTMLDocument).body
    .firstElementChild as HTMLElement;
};

/** Creates an image element from a src string. */
export const ImageElementFromSrc = (src: string): HTMLImageElement => {
  const image = document.createElement('img');
  image.src = src;
  return image;
};
