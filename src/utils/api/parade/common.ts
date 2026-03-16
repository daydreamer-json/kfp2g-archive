import ky from 'ky';
import type * as IParadeApi from '../../../types/api/parade/Api.js';
import config from '../../config.js';
import configAuth from '../../configAuth.js';
import crypt from './crypt.js';
import defaultSettings from './defaultSettings.js';

const BASE_URL = config.network.api.parade.base.prod;

export default {
  getUrl: async (version: string, platform: number = 4) => {
    const endpoint = 'common/GetUrl.do';
    const url = `https://${BASE_URL}/${endpoint}`;
    const params = {
      version,
      dmm_viewer_id: configAuth.get().dmm.viewerId,
      account: '',
      platform,
    };
    const rsp = await ky
      .get(url, { ...defaultSettings.ky, searchParams: { param: crypt.encrypt(params) } })
      .arrayBuffer();
    return crypt.decode(rsp) as IParadeApi.GetUrlResponse;
  },
  mstVersion: async () => {
    const endpoint = 'common/MstVersion.do';
    const url = `https://${BASE_URL}/${endpoint}`;
    const params = { dmm_viewer_id: configAuth.get().dmm.viewerId };
    const rsp = await ky
      .get(url, { ...defaultSettings.ky, searchParams: { param: crypt.encrypt(params) } })
      .arrayBuffer();
    return crypt.decode(rsp) as IParadeApi.MstVersionResponse;
  },
  mstData: async (type: string) => {
    const endpoint = 'common/MstData.do';
    const url = `https://${BASE_URL}/${endpoint}`;
    const params = { type, dmm_viewer_id: configAuth.get().dmm.viewerId };
    const rsp = await ky
      .get(url, { ...defaultSettings.ky, searchParams: { param: crypt.encrypt(params) } })
      .arrayBuffer();
    return crypt.decode(rsp) as IParadeApi.MstDataResponse;
  },
};
