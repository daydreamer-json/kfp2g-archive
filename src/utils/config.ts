import deepmerge from 'deepmerge';
import YAML from 'yaml';
import * as TypesLogLevels from '../types/LogLevels.js';

type Freeze<T> = Readonly<{
  [P in keyof T]: T[P] extends object ? Freeze<T[P]> : T[P];
}>;
type AllRequired<T> = Required<{
  [P in keyof T]: T[P] extends object ? Freeze<T[P]> : T[P];
}>;

type ConfigType = AllRequired<
  Freeze<{
    network: {
      api: {
        dmm: {
          base: string;
          userAgent: string;
          clientApp: string;
          clientVersion: string;
          productId: string;
          gameType: 'GCL' | 'ACL';
          launchType: string;
        };
        parade: {
          base: Record<
            'local' | 'develop01' | 'develop02' | 'develop03' | 'develop04' | 'qa' | 'stage' | 'prod',
            string
          >;
          userAgent: Record<'sim' | 'chat', string>;
          encryptKey: Record<'default' | 'account', string>;
        };
      };
      userAgent: {
        // UA to hide the fact that the access is from this tool
        minimum: string;
        chromeWindows: string;
        curl: string;
        ios: string;
      };
      timeout: number; // Network timeout
      retryCount: number; // Number of retries for access failure
    };
    threadCount: {
      // Upper limit on the number of threads for parallel processing
      network: number; // network access
    };
    cli: {
      autoExit: boolean; // Whether to exit the tool without waiting for key input when the exit code is 0
    };
    logger: {
      // log4js-node logger settings
      logLevel: TypesLogLevels.LogLevelNumber;
      useCustomLayout: boolean;
      customLayoutPattern: string;
    };
  }>
>;

const initialConfig: ConfigType = {
  network: {
    api: {
      dmm: {
        base: 'apidgp-gameplayer.games.dmm.com/v5',
        userAgent: 'DMMGamePlayer5-Win/5.3.25 Electron/34.3.0',
        clientApp: 'DMMGamePlayer5',
        clientVersion: '5.3.25',
        productId: 'kfp2g',
        gameType: 'GCL',
        launchType: 'LIB',
      },
      parade: {
        base: {
          local: 'bG9jYWxob3N0OjgwODAvcGFyYWRlc3ZfbG9jYWw=',
          develop01: 'cGFyYWRlLW1vYmlsZS1kZXZlbG9wMDEtYXBwLmtlbW9uby1mcmllbmRzLTMuanAvcGFyYWRlc3Y=',
          develop02: 'cGFyYWRlLW1vYmlsZS1kZXZlbG9wMDItYXBwLmtlbW9uby1mcmllbmRzLTMuanAvcGFyYWRlc3Y=',
          develop03: 'cGFyYWRlLW1vYmlsZS1kZXZlbG9wMDMtYXBwLmtlbW9uby1mcmllbmRzLTMuanAvcGFyYWRlc3Y=',
          develop04: 'cGFyYWRlLW1vYmlsZS1kZXZlbG9wMDQtYXBwLmtlbW9uby1mcmllbmRzLTMuanAvcGFyYWRlc3Y=',
          qa: 'cGFyYWRlLW1vYmlsZS1xYS1hcHAua2Vtb25vLWZyaWVuZHMtMy5qcC9wYXJhZGVzdg==',
          stage: 'cGFyYWRlLW1vYmlsZS1zdGctYXBwLmtlbW9uby1mcmllbmRzLTMuanAvcGFyYWRlc3Y=',
          prod: 'cGFyYWRlLW1vYmlsZS1wcm9kLWFwcC5rZW1vbm8tZnJpZW5kcy0zLmpwL3BhcmFkZXN2',
        },
        encryptKey: {
          default: 'TUVEQVJBUA==',
          account: 'QUNDT1VOVF9TVFJJTkc=',
        },
        userAgent: {
          sim: 'U0VHQSBXZWIgQ2xpZW50IGZvciBQcm9qZWN0IDIwMTU=',
          chat: 'U0VHQSBXZWIgQ2xpZW50IGZvciBQcm9qZWN0IDIwMTUgQ0hBVA==',
        },
      },
    },
    userAgent: {
      minimum: 'Mozilla/5.0',
      chromeWindows:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
      curl: 'curl/8.4.0',
      ios: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    },
    timeout: 20000,
    retryCount: 5,
  },
  threadCount: { network: 16 },
  cli: { autoExit: false },
  logger: {
    logLevel: 0,
    useCustomLayout: true,
    customLayoutPattern: '%[%d{hh:mm:ss.SSS} %-5.0p >%] %m',
  },
};

const deobfuscator = (input: ConfigType): ConfigType => {
  const newConfig = JSON.parse(JSON.stringify(input)) as any;
  const api = newConfig.network.api.parade;
  for (const key of Object.keys(api.base) as (keyof typeof api.base)[]) {
    api.base[key] = atob(api.base[key]);
  }
  for (const key of Object.keys(api.encryptKey) as (keyof typeof api.encryptKey)[]) {
    api.encryptKey[key] = atob(api.encryptKey[key]);
  }
  for (const key of Object.keys(api.userAgent) as (keyof typeof api.userAgent)[]) {
    api.userAgent[key] = atob(api.userAgent[key]);
  }
  return newConfig as ConfigType;
};

const filePath = 'config/config.yaml';

if ((await Bun.file(filePath).exists()) === false) {
  await Bun.write(filePath, YAML.stringify(initialConfig));
}

const config: ConfigType = await (async () => {
  const rawFileData: ConfigType = YAML.parse(await Bun.file(filePath).text()) as ConfigType;
  const mergedConfig = deepmerge(initialConfig, rawFileData, {
    arrayMerge: (_destinationArray, sourceArray) => sourceArray,
  });
  if (JSON.stringify(rawFileData) !== JSON.stringify(mergedConfig)) {
    await Bun.write(filePath, YAML.stringify(mergedConfig));
  }
  return deobfuscator(mergedConfig);
})();

export default config;
