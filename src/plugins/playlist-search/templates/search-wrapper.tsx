export interface SearchWrapperProps {
  id: string;
  placeholder: string;
}

const MagGlassSvg = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="currentColor"
    height="24"
    viewBox="0 0 24 24"
    width="24"
    style={{
      'pointer-events': 'none',
      'display': 'block',
      'width': '100%',
      'height': '100%',
    }}
  >
    <path
      d="M16.296 16.996a8 8 0 11.707-.708l3.909 3.91-.707.707-3.909-3.909zM18 11a7 7 0 00-14 0 7 7 0 1014 0z"
      fill="currentColor"
      stroke="currentColor"
      stroke-width="0.5"
      fill-rule="evenodd"
      clip-rule="evenodd"
    />
  </svg>
);

export const SearchWrapper = (props: SearchWrapperProps) => (
  <div id={`pear-pls-${props.id}-wrapper`} class="pear-pls-wrapper">
    <span class="pear-pls-search-icon" aria-hidden="true">
      <MagGlassSvg />
    </span>
    <input
      type="text"
      class="pear-pls-input"
      id={`pear-pls-${props.id}-search-input`}
      placeholder={props.placeholder}
      autocomplete="off"
    />
  </div>
);
