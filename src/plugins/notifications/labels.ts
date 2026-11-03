import { t } from '@/i18n';

export const ToastStyles = {
  logo: 1,
  banner_centered_top: 2,
  hero: 3,
  banner_top_custom: 4,
  banner_centered_bottom: 5,
  banner_bottom: 6,
  legacy: 7,
};

const toastStyleLabelKeys: Record<keyof typeof ToastStyles, string> = {
  logo: 'plugins.notifications.toast-style.logo',
  banner_centered_top: 'plugins.notifications.toast-style.banner-centered-top',
  hero: 'plugins.notifications.toast-style.hero',
  banner_top_custom: 'plugins.notifications.toast-style.banner-top-custom',
  banner_centered_bottom:
    'plugins.notifications.toast-style.banner-centered-bottom',
  banner_bottom: 'plugins.notifications.toast-style.banner-bottom',
  legacy: 'plugins.notifications.toast-style.legacy',
};

export const toastStyleLabel = (style: keyof typeof ToastStyles) =>
  t(toastStyleLabelKeys[style]);

export const urgencyLevels = [
  { name: () => t('plugins.notifications.urgency.low'), value: 'low' },
  { name: () => t('plugins.notifications.urgency.normal'), value: 'normal' },
  { name: () => t('plugins.notifications.urgency.high'), value: 'critical' },
] as const;
