import appConfig from '../../config.js';

export default {
  ky: {
    headers: {
      'Client-App': appConfig.network.api.dmm.clientApp,
      'Client-Version': appConfig.network.api.dmm.clientVersion,
      'User-Agent': appConfig.network.api.dmm.userAgent,
    },
    timeout: appConfig.network.timeout,
    retry: { limit: appConfig.network.retryCount },
  },
};
