export type AmbientModeStyle = 'standard' | 'ambilight';
export type AmbientModeTheme = 'auto' | 'light' | 'dark';
export type AmbientModeSync = 'decoded' | 'display' | 'video';

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
  barDetection: boolean;
  brightness: number;
  contrast: number;
  saturation: number;
  theme: AmbientModeTheme;
  dimming: number;
  fadeStart: number;
  fadeCurve: number;
  fadeIn: number;
  sync: AmbientModeSync;
  energySaver: boolean;
};
