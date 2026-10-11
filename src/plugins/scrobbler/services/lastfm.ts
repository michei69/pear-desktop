import crypto from 'node:crypto';

import { BrowserWindow, dialog, net } from 'electron';

import { t } from '@/i18n';

import { ScrobblerBase } from './base';

import type { ScrobblerPluginConfig } from '../index';
import type { SetConfType } from '../main';
import type { SongInfo } from '@/providers/song-info';

interface LastFmData {
  method: string;
  timestamp?: number;
}

interface LastFmSongData {
  track?: string;
  duration?: number;
  artist?: string;
  album?: string;
  api_key: string;
  sk?: string;
  format: string;
  method: string;
  timestamp?: number;
  api_sig?: string;
}

export class LastFmScrobbler extends ScrobblerBase {
  mainWindow: BrowserWindow;

  constructor(mainWindow: BrowserWindow) {
    super();

    this.mainWindow = mainWindow;
  }

  override isSessionCreated(config: ScrobblerPluginConfig): boolean {
    return !!config.scrobblers.lastfm.sessionKey;
  }

  override async createSession(
    config: ScrobblerPluginConfig,
    setConfig: SetConfType,
  ): Promise<ScrobblerPluginConfig> {
    try {
      const data = {
        api_key: config.scrobblers.lastfm.apiKey,
        format: 'json',
        method: 'auth.getsession',
        token: config.scrobblers.lastfm.token,
      };
      const apiSignature = createApiSig(data, config.scrobblers.lastfm.secret);
      const response = await net.fetch(
        `${config.scrobblers.lastfm.apiRoot}${createQueryString(data, apiSignature)}`,
      );
      const json = (await response.json()) as {
        error?: string;
        session?: {
          key: string;
        };
      };
      if (json.error) {
        config.scrobblers.lastfm.token = await createToken(config);
        // Retry the request once authenticated
        authenticate(config, this.mainWindow).then((it) => {
          if (it) {
            this.createSession(config, setConfig);
          } else {
            setConfig(config);
          }
        });
      }
      if (json.session) {
        config.scrobblers.lastfm.sessionKey = json.session.key;
      }
      setConfig(config);
    } catch (error) {
      console.error('Failed to create Last.fm session:', error);
    }
    return config;
  }

  override setNowPlaying(
    songInfo: SongInfo,
    config: ScrobblerPluginConfig,
    setConfig: SetConfType,
  ): void {
    if (!config.scrobblers.lastfm.sessionKey) {
      return;
    }

    const data = {
      method: 'track.updateNowPlaying',
    };
    this.postSongDataToAPI(songInfo, config, data, setConfig);
  }

  override addScrobble(
    songInfo: SongInfo,
    config: ScrobblerPluginConfig,
    setConfig: SetConfType,
  ): void {
    if (!config.scrobblers.lastfm.sessionKey) {
      return;
    }

    const data = {
      method: 'track.scrobble',
      // Date.now() is ms and elapsedSeconds is seconds — convert before subtracting
      timestamp: Math.trunc(Date.now() / 1000) - (songInfo.elapsedSeconds ?? 0),
    };
    this.postSongDataToAPI(songInfo, config, data, setConfig);
  }

  private async postSongDataToAPI(
    songInfo: SongInfo,
    config: ScrobblerPluginConfig,
    data: LastFmData,
    setConfig: SetConfType,
  ): Promise<void> {
    // Adds the common fields and posts to the API
    if (!config.scrobblers.lastfm.sessionKey) {
      await this.createSession(config, setConfig);
    }

    const title = songInfo.title;
    const artist = songInfo.artist;

    const postData: LastFmSongData = {
      track: title,
      duration: songInfo.songDuration,
      artist: artist,
      ...(songInfo.album ? { album: songInfo.album } : undefined), // undefined for videos
      api_key: config.scrobblers.lastfm.apiKey,
      sk: config.scrobblers.lastfm.sessionKey,
      format: 'json',
      ...data,
    };

    postData.api_sig = createApiSig(postData, config.scrobblers.lastfm.secret);
    const formData = createFormData(postData);
    try {
      // apiRoot already includes the /2.0/ path (see defaultConfig); appending it again would double it
      const response = await net.fetch(config.scrobblers.lastfm.apiRoot, {
        method: 'POST',
        body: formData,
      });
      const json = (await response.json()) as { error?: number };
      if (json.error === 9) {
        // error 9: session key invalid — clear it and reauthenticate
        config.scrobblers.lastfm.sessionKey = undefined;
        config.scrobblers.lastfm.token = await createToken(config);
        authenticate(config, this.mainWindow).then((it) => {
          if (it) {
            this.createSession(config, setConfig);
          } else {
            setConfig(config);
          }
        });
      } else if (json.error) {
        console.error(`Last.fm API error: ${json.error}`);
      }
    } catch (error) {
      console.error('Failed to submit data to Last.fm:', error);
    }
  }
}

const createFormData = (parameters: LastFmSongData) => {
  // Last.fm expects application/x-www-form-urlencoded; FormData would send
  // multipart/form-data, which the API does not reliably accept.
  const formData = new URLSearchParams();
  Object.entries(parameters).forEach(([key, value]) => {
    if (value !== undefined) {
      formData.append(key, String(value));
    }
  });
  return formData;
};

const createQueryString = (
  parameters: Record<string, unknown>,
  apiSignature: string,
) => {
  const queryData = [];
  parameters.api_sig = apiSignature;
  for (const key in parameters) {
    queryData.push(
      `${encodeURIComponent(key)}=${encodeURIComponent(
        String(parameters[key]),
      )}`,
    );
  }

  return '?' + queryData.join('&');
};

const createApiSig = (parameters: LastFmSongData, secret: string) => {
  // See https://www.last.fm/api/authspec
  let sig = '';

  Object.entries(parameters)
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([key, value]) => {
      if (key === 'format') {
        return;
      }
      sig += key + value;
    });

  sig += secret;
  sig = crypto.createHash('md5').update(sig, 'utf-8').digest('hex');
  return sig;
};

const createToken = async ({
  scrobblers: {
    lastfm: { apiKey, apiRoot, secret },
  },
}: ScrobblerPluginConfig) => {
  const data: {
    method: string;
    api_key: string;
    format: string;
  } = {
    method: 'auth.gettoken',
    api_key: apiKey,
    format: 'json',
  };
  const apiSigature = createApiSig(data, secret);
  const response = await net.fetch(
    `${apiRoot}${createQueryString(data, apiSigature)}`,
  );
  const json = (await response.json()) as Record<string, string>;
  return json?.token;
};

let authWindowOpened = false;
let latestAuthResult = false;

const authenticate = async (
  config: ScrobblerPluginConfig,
  mainWindow: BrowserWindow,
) => {
  return new Promise<boolean>((resolve) => {
    if (!authWindowOpened) {
      authWindowOpened = true;
      const url = `https://www.last.fm/api/auth/?api_key=${config.scrobblers.lastfm.apiKey}&token=${config.scrobblers.lastfm.token}`;
      const browserWindow = new BrowserWindow({
        width: 500,
        height: 600,
        show: false,
        webPreferences: {
          nodeIntegration: false,
        },
        autoHideMenuBar: true,
        parent: mainWindow,
        minimizable: false,
        maximizable: false,
        paintWhenInitiallyHidden: true,
        modal: true,
        center: true,
      });
      browserWindow.loadURL(url).then(() => {
        browserWindow.show();
        browserWindow.webContents.on('did-navigate', async (_, newUrl) => {
          const url = URL.parse(newUrl);
          if (url?.hostname.endsWith('last.fm')) {
            if (url.pathname === '/api/auth') {
              const isApproveScreen =
                (await browserWindow.webContents.executeJavaScript(
                  "!!document.getElementsByName('confirm').length",
                )) as boolean;
              // not the approve screen, so authentication succeeded
              if (!isApproveScreen) {
                resolve(true);
                latestAuthResult = true;
                browserWindow.close();
              }
            } else if (url.pathname === '/api/None') {
              resolve(false);
              latestAuthResult = false;
              browserWindow.close();
            }
          }
        });
        browserWindow.on('closed', () => {
          if (!latestAuthResult) {
            dialog.showMessageBox({
              title: t('plugins.scrobbler.dialog.lastfm.auth-failed.title'),
              message: t('plugins.scrobbler.dialog.lastfm.auth-failed.message'),
              type: 'error',
            });
          }
          authWindowOpened = false;
        });
      });
    } else {
      // wait for the previous auth window to close
      const waitForClose = async () => {
        while (authWindowOpened) {
          await new Promise((r) => setTimeout(r, 100));
        }
        resolve(latestAuthResult);
      };
      waitForClose();
    }
  });
};
