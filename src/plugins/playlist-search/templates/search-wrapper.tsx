export interface SearchWrapperProps {
  id: string;
  placeholder: string;
}

const MagGlassSvg = () => (
  <svg
    fill="currentColor"
    height="24"
    style={{
      'pointer-events': 'none',
      'display': 'block',
      'width': '100%',
      'height': '100%',
    }}
    viewBox="0 0 24 24"
    width="24"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      clip-rule="evenodd"
      d="M16.296 16.996a8 8 0 11.707-.708l3.909 3.91-.707.707-3.909-3.909zM18 11a7 7 0 00-14 0 7 7 0 1014 0z"
      fill="currentColor"
      fill-rule="evenodd"
      stroke="currentColor"
      stroke-width="0.5"
    />
  </svg>
);

export const SearchWrapper = (props: SearchWrapperProps) => (
  <div class="pear-pls-wrapper" id={`pear-pls-${props.id}-wrapper`}>
    <span aria-hidden="true" class="pear-pls-search-icon">
      <MagGlassSvg />
    </span>
    <input
      autocomplete="off"
      class="pear-pls-input"
      id={`pear-pls-${props.id}-search-input`}
      placeholder={props.placeholder}
      type="text"
    />
  </div>
);
