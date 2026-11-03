import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import style from './style.css?inline';

export default createPlugin({
  name: () => t('plugins.no-google-login.name'),
  description: () => t('plugins.no-google-login.description'),
  config: {
    enabled: false,
  },
  stylesheets: [style],
  // The stylesheet hides the sign-in affordances; the empty renderer object is
  // kept so the loader adopts/un-adopts the sheet on live enable/disable.
  renderer: {},
});
