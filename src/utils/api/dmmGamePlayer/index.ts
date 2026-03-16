import crypto from 'node:crypto';
import ky from 'ky';
import * as TypesApiDgp from '../../../types/api/dmmGamePlayer/Api.js';
import config from '../../config.js';
import defaultSettings from './defaultSettings.js';

const getDeviceHeader = () => {
  return {
    mac_address: crypto.randomBytes(6).toString('hex').match(/../g)!.join(':'),
    hdd_serial: crypto.randomBytes(32).toString('hex'),
    motherboard: crypto.randomBytes(32).toString('hex'),
    user_os: 'win',
  };
};

export default {
  auth: {
    accesstoken: {
      check: async (accessToken: string, expiresInSeconds?: number): Promise<TypesApiDgp.AuthAccesstokenCheck> => {
        const rsp = await ky
          .post(`https://${config.network.api.dmm.base}/auth/accesstoken/check`, {
            ...defaultSettings.ky,
            json: { access_token: accessToken, expires_in_seconds: expiresInSeconds },
          })
          .json();
        return rsp as TypesApiDgp.AuthAccesstokenCheck;
      },
    },
  },
  r2: {
    launch: {
      cl: async (
        actauth: string,
        productId: string,
        gameType: 'GCL' | 'ACL',
        launchType: string = 'LIB',
      ): Promise<TypesApiDgp.R2LaunchCl> => {
        const rsp = await ky
          .post(`https://${config.network.api.dmm.base}/r2/launch/cl`, {
            ...defaultSettings.ky,
            headers: { ...defaultSettings.ky.headers, actauth },
            json: {
              product_id: productId,
              game_type: gameType,
              game_os: 'win',
              launch_type: launchType,
              ...getDeviceHeader(),
            },
          })
          .json();
        return rsp as TypesApiDgp.R2LaunchCl;
      },
    },
    install: {
      cl: async (actauth: string, productId: string, gameType: 'GCL' | 'ACL'): Promise<TypesApiDgp.R2InstallCl> => {
        const rsp = await ky
          .post(`https://${config.network.api.dmm.base}/r2/install/cl`, {
            ...defaultSettings.ky,
            headers: { ...defaultSettings.ky.headers, actauth },
            json: {
              product_id: productId,
              game_type: gameType,
              game_os: 'win',
              ...getDeviceHeader(),
            },
          })
          .json();
        return rsp as TypesApiDgp.R2InstallCl;
      },
    },
  },
  getFilelist: async (_actauth: string, url: string): Promise<TypesApiDgp.Filelist> => {
    const rsp = await ky
      .get(`https://${new URL('https://' + config.network.api.dmm.base).host}${url}`, {
        ...defaultSettings.ky,
        headers: { ...defaultSettings.ky.headers },
      })
      .json();
    return rsp as TypesApiDgp.Filelist;
  },
  defaultSettings,
};
