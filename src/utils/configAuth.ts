import deepmerge from 'deepmerge';
import YAML from 'yaml';

const filePath = 'config/config_auth.yaml';

export type ConfigType = {
  dmm: {
    accessToken: string | null;
    viewerId: number | null;
  };
  github: {
    relArchive: { token: string; owner: string; repo: string; tag: string };
    main: { token: string; owner: string; repo: string };
  };
};

const initialConfig: ConfigType = {
  dmm: {
    accessToken: null,
    viewerId: null,
  },
  github: {
    relArchive: { token: '', owner: '', repo: '', tag: '' },
    main: { token: '', owner: '', repo: '' },
  },
};

const cloneConfig = (input: ConfigType): ConfigType => {
  return structuredClone(input);
};

const deepFreeze = <T extends object>(obj: T): Readonly<T> => {
  Object.freeze(obj);
  Object.getOwnPropertyNames(obj).forEach((prop) => {
    const value = (obj as Record<string, unknown>)[prop];
    if (value !== null && (typeof value === 'object' || typeof value === 'function') && !Object.isFrozen(value)) {
      deepFreeze(value as object);
    }
  });
  return obj as Readonly<T>;
};

if ((await Bun.file(filePath).exists()) === false) {
  await Bun.write(filePath, YAML.stringify(initialConfig));
}

let _config: Readonly<ConfigType> = await (async () => {
  const rawFileData = YAML.parse(await Bun.file(filePath).text()) as Partial<ConfigType>;
  const mergedConfig = deepmerge(initialConfig, rawFileData || {}, {
    arrayMerge: (_destinationArray, sourceArray) => sourceArray,
  }) as ConfigType;
  if (JSON.stringify(rawFileData) !== JSON.stringify(mergedConfig)) {
    await Bun.write(filePath, YAML.stringify(mergedConfig));
  }
  return deepFreeze(cloneConfig(mergedConfig));
})();

export const getConfig = (): Readonly<ConfigType> => {
  return _config;
};

export const setConfig = async (newConfig: ConfigType): Promise<void> => {
  const processedConfig = cloneConfig(newConfig);
  await Bun.write(filePath, YAML.stringify(processedConfig));
  _config = deepFreeze(processedConfig);
};

export default { get: getConfig, set: setConfig };
