import { t } from '@/i18n';

import { BulkActionButton } from './bulk-action-button';

const ICON_PATH =
  'M3,11h3v10H3V11z M18.77,11h-4.23l1.52-4.94C16.38,5.03,15.54,4,14.38,4c-0.58,0-1.14,0.24-1.52,0.65L7,11v10h10.43 c1.06,0,1.98-0.67,2.19-1.61l1.34-6C21.23,12.15,20.18,11,18.77,11z';

export interface LikeButtonProps {
  onClick?: (e: MouseEvent) => void;
  maskSize: string;
}

export const LikeButton = (props: LikeButtonProps) => (
  <BulkActionButton
    dataFilled="false"
    dataType="like"
    iconPath={ICON_PATH}
    id="alllike"
    label={t('plugins.album-actions.templates.like-all')}
    maskSize={props.maskSize}
    onClick={props.onClick}
  />
);
