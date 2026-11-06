export type AmbientModeStyle = 'standard' | 'ambilight';

export type AmbientModePluginConfig = {
  enabled: boolean;
  style: AmbientModeStyle;
  quality: number;
  buffer: number;
  interpolationTime: number;
  blur: number;
  size: number;
  opacity: number;
  fullscreen: boolean;
  extendSidebar: boolean;
};
