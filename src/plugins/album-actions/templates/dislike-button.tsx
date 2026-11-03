import { t } from '@/i18n';

import { BulkActionButton } from './bulk-action-button';

const ICON_PATH =
  'M18,4h3v10h-3V4z M5.23,14h4.23l-1.52,4.94C7.62,19.97,8.46,21,9.62,21c0.58,0,1.14-0.24,1.52-0.65L17,14V4H6.57 C5.5,4,4.59,4.67,4.38,5.61l-1.34,6C2.77,12.85,3.82,14,5.23,14z';

export interface DislikeButtonProps {
  onClick?: (e: MouseEvent) => void;
  maskSize: string;
}

export const DislikeButton = (props: DislikeButtonProps) => (
  <BulkActionButton
    dataFilled="false"
    dataType="dislike"
    iconPath={ICON_PATH}
    id="alldislike"
    label={t('plugins.album-actions.templates.dislike-all')}
    maskSize={props.maskSize}
    onClick={props.onClick}
  />
);
