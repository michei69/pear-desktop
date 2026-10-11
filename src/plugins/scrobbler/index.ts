import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import { backend } from './main';
import { onMenu } from './menu';

export interface ScrobblerPluginConfig {
  enabled: boolean;
  /** Attempt to scrobble other video types (e.g. Podcasts, normal videos). @default true */
  scrobbleOtherMedia: boolean;
  /** Use alternative titles for scrobbling non-roman titles (e.g. (Not) A Devil -> デビルじゃないもん). @default true */
  alternativeTitles: boolean;
  /** Use the alternative artist for scrobbling (e.g. DECO27 & (or) PinocchioP -> DECO27 / marasy -> まらしぃ). @default true */
  alternativeArtist: boolean;
  /** Regexes used to filter garbage from track titles and artists */
  customRegexFilters: string[];
  /** Use MusicBrainz to verify and correct song titles and artists. @default false */
  useMusicBrainz: boolean;
  /** Contact email for the MusicBrainz API User-Agent */
  musicBrainzEmail: string;
  scrobblers: {
    lastfm: {
      /** Enable Last.fm scrobbling. @default false */
      enabled: boolean;
      /** Auth token */
      token: string | undefined;
      /** Session key used for scrobbling */
      sessionKey: string | undefined;
      /** Root of the Last.fm API. @default 'http://ws.audioscrobbler.com/2.0/' */
      apiRoot: string;
      /** Last.fm api key registered by @semvis123. @default '04d76faaac8726e60988e14c105d421a' */
      apiKey: string;
      /** Last.fm api secret registered by @semvis123. @default 'a5d2a36fdf64819290f6982481eaffa2' */
      secret: string;
    };
    listenbrainz: {
      /** Enable ListenBrainz scrobbling. @default false */
      enabled: boolean;
      /** ListenBrainz user token */
      token: string | undefined;
      /** Root of the ListenBrainz API. @default 'https://api.listenbrainz.org/1/' */
      apiRoot: string;
    };
  };
}

export const defaultConfig: ScrobblerPluginConfig = {
  enabled: false,
  scrobbleOtherMedia: true,
  alternativeTitles: true,
  alternativeArtist: true,
  useMusicBrainz: false,
  musicBrainzEmail: '',
  customRegexFilters: [
    // (Explicit) or [Explicit] or Clean
    '\\s[([]Explicit[)\\]]',
    '\\s[([]Clean[)\\]]',
    // Features
    '\\s[([]feat\\. [^)\\]]+[)\\]]',
    '\\s[([]ft\\. [^)\\]]+[)\\]]',
    // Live
    '\\s-\\sLive(\\s.+)?$',
    '\\s[([]Live[)\\]]$',
    // Parodies and adaptations
    '\\s\\(Parody of ".*" by .*\\)$',
    '\\s\\(Lyrical Adaption of ".*"\\)$',
    // Re-issue
    '\\sRe-?issue$',
    '\\s\\[.*?Re-?issue.*?\\]',
    '\\s\\(.*?Re-?issue.*?\\)',
    // Remastered
    'Live\\s\\/\\sRemastered',
    '\\s[([][^)\\]]*Re-?[Mm]aster(ed)?[^)\\]]*[)\\]]$',
    '\\s-\\s\\d{4}(\\s-)?\\s.*Re-?[Mm]aster(ed)?.*$',
    '\\s-\\sRe-?[Mm]aster(ed)?.*$',
    '\\s\\[Remastered\\]\\s\\(Remastered\\sVersion\\)$',
    // Versions
    '\\s[([]Album Version[)\\]]$',
    '\\s[([]Re-?recorded[)\\]]$',
    '\\s[([]Single Version[)\\]]$',
    '\\s[([]Edit[)\\]]$',
    '\\s-\\sMono Version$',
    '\\s-\\sStereo Version$',
    '\\s\\(Deluxe Edition\\)$',
    '\\s[([]Expanded.*[)\\]]$',
    '\\s-\\sExpanded Edition$',
    '\\s[([]Explicit Version[)\\]]',
    '\\s[([]Bonus Track Edition[)\\]]',
    '\\s[([]\\d+th\\sAnniversary.*[)\\]]',
    '\\s-\\sOriginal$',
    '\\s-\\sOriginal.*Version(\\s\\d{4})?$',
    // YouTube specific
    '\\*+\\s?\\S+\\s?\\*+$',
    '\\[[^\\]]+\\]',
    '【[^】]+】',
    '（[^）]+）',
    '\\([^)]*version\\)$',
    '\\.(avi|wmv|mpg|mpeg|flv)$',
    '\\(.*lyrics?\\s*(video)?\\)',
    '\\((of+icial\\s*)?(track\\s*)?stream\\)',
    '\\((of+icial\\s*)?((music|hd)\\s*)?(video|audio)\\)',
    '-\\s(of+icial\\s*)?(music\\s*)?(video|audio)$',
    '\\(.*Album\\sTrack\\)',
    '\\(\\s*of+icial\\s*\\)',
    '\\(\\s*[0-9]{4}\\s*\\)',
    '\\(\\s*(HD|HQ)\\s*\\)$',
    '(HD|HQ)\\s?$',
    '(vid[\u00E9e]o)?\\s?clip\\sof+ici[ae]l',
    'of+iziel+es\\s*video',
    'vid[\u00E9e]o\\s?clip',
    '\\sclip',
    'full\\s*album',
    '\\(live.*?\\)$',
    '\\|.*$',
    '\\(.*[0-9]{1,2}\\/[0-9]{1,2}\\/[0-9]{2,4}.*\\)',
    'sub\\s*español',
    '\\s\\(Letra\\)',
    '\\s\\(En\\svivo\\)',
  ],
  scrobblers: {
    lastfm: {
      enabled: false,
      token: undefined,
      sessionKey: undefined,
      apiRoot: 'https://ws.audioscrobbler.com/2.0/',
      apiKey: '04d76faaac8726e60988e14c105d421a',
      secret: 'a5d2a36fdf64819290f6982481eaffa2',
    },
    listenbrainz: {
      enabled: false,
      token: undefined,
      apiRoot: 'https://api.listenbrainz.org/1/',
    },
  },
};

export default createPlugin({
  name: () => t('plugins.scrobbler.name'),
  description: () => t('plugins.scrobbler.description'),
  restartNeeded: true,
  config: defaultConfig,
  settings: [
    {
      fields: [
        {
          type: 'switch',
          key: 'scrobbleOtherMedia',
          label: () => t('plugins.scrobbler.menu.scrobble-other-media'),
        },
        {
          type: 'switch',
          key: 'alternativeTitles',
          label: () => t('plugins.scrobbler.menu.scrobble-alternative-title'),
        },
        {
          type: 'switch',
          key: 'alternativeArtist',
          label: () => t('plugins.scrobbler.menu.scrobble-alternative-artist'),
        },
        {
          type: 'switch',
          key: 'useMusicBrainz',
          label: () => t('plugins.scrobbler.menu.use-musicbrainz'),
        },
        {
          type: 'text',
          key: 'musicBrainzEmail',
          label: () => t('plugins.scrobbler.menu.musicbrainz-email'),
          description: () =>
            t('plugins.scrobbler.settings.musicbrainz-email-description'),
          placeholder: () => 'you@example.com',
        },
      ],
    },
    {
      title: () => 'Last.fm',
      fields: [
        {
          type: 'switch',
          key: 'scrobblers.lastfm.enabled',
          label: () => t('main.menu.plugins.enabled'),
        },
        {
          type: 'text',
          key: 'scrobblers.lastfm.apiKey',
          label: () => t('plugins.scrobbler.prompt.lastfm.api-key'),
        },
        {
          type: 'text',
          key: 'scrobblers.lastfm.secret',
          label: () => t('plugins.scrobbler.prompt.lastfm.api-secret'),
        },
        {
          type: 'text',
          key: 'scrobblers.lastfm.apiRoot',
          label: () => t('plugins.scrobbler.settings.lastfm-api-root'),
        },
      ],
    },
    {
      title: () => 'ListenBrainz',
      fields: [
        {
          type: 'switch',
          key: 'scrobblers.listenbrainz.enabled',
          label: () => t('main.menu.plugins.enabled'),
        },
        {
          type: 'text',
          key: 'scrobblers.listenbrainz.token',
          label: () => t('plugins.scrobbler.menu.listenbrainz.token'),
        },
        {
          type: 'text',
          key: 'scrobblers.listenbrainz.apiRoot',
          label: () => t('plugins.scrobbler.menu.listenbrainz.api-root'),
        },
      ],
    },
  ],
  menu: onMenu,
  backend,
});
