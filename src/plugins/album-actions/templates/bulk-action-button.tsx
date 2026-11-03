import type { JSX } from 'solid-js';

export interface BulkActionButtonProps {
  id: string;
  label: string;
  dataType: 'like' | 'dislike';
  dataFilled: 'true' | 'false';
  iconPath: string;
  maskSize: string;
  onClick?: (e: MouseEvent) => void;
}

const iconWrapperStyle: JSX.CSSProperties = {
  'width': '24px',
  'height': '24px',
};

const svgStyle: JSX.CSSProperties = {
  'pointer-events': 'none',
  'display': 'block',
  'width': '100%',
  'height': '100%',
};

const Icon = (props: { path: string }) => (
  <div style={iconWrapperStyle}>
    <svg
      class="style-scope yt-icon"
      preserveAspectRatio="xMidYMid meet"
      style={svgStyle}
      viewBox="0 0 24 24"
    >
      <g class="style-scope yt-icon">
        <path class="style-scope yt-icon" d={props.path} />
      </g>
    </svg>
  </div>
);

export const BulkActionButton = (props: BulkActionButtonProps) => (
  <div class="style-scope">
    <button
      aria-label={props.label}
      aria-pressed="false"
      class="like-menu yt-spec-button-shape-next yt-spec-button-shape-next--text yt-spec-button-shape-next--mono yt-spec-button-shape-next--size-m yt-spec-button-shape-next--icon-button"
      data-filled={props.dataFilled}
      data-type={props.dataType}
      id={props.id}
      onClick={(e) => props.onClick?.(e)}
    >
      <div
        aria-hidden="true"
        class="yt-spec-button-shape-next__icon"
        style={{ color: 'var(--ytmusic-setting-item-toggle-active)' }}
      >
        <div
          aria-hidden="true"
          class="yt-spec-button-shape-next__icon"
          style={{
            'color': 'white',
            'mask': 'linear-gradient(grey, grey)',
            '-webkit-mask': 'linear-gradient(grey, grey)',
            '-webkit-mask-size': props.maskSize,
            '-webkit-mask-repeat': 'no-repeat',
            'z-index': 1,
            'position': 'absolute',
          }}
        >
          <Icon path={props.iconPath} />
        </div>
        <Icon path={props.iconPath} />
      </div>
      <yt-touch-feedback-shape style={{ 'border-radius': 'inherit' }}>
        <div
          aria-hidden="true"
          class="yt-spec-touch-feedback-shape yt-spec-touch-feedback-shape--touch-response"
        >
          <div class="yt-spec-touch-feedback-shape__stroke" />
          <div class="yt-spec-touch-feedback-shape__fill" />
        </div>
      </yt-touch-feedback-shape>
    </button>
  </div>
);
