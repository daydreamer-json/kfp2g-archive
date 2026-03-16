import appConfig from '../../config.js';

export default {
  ky: {
    headers: {
      'User-Agent': appConfig.network.api.parade.userAgent.sim,
      'Accept-Encoding': 'gzip',
    },
    timeout: appConfig.network.timeout,
    retry: { limit: appConfig.network.retryCount },
  },
};
