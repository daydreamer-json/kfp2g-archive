import path from 'node:path';
import ky, { HTTPError } from 'ky';
import { DateTime } from 'luxon';
import PQueue from 'p-queue';
import semver from 'semver';
import * as TypesApiDgp from '../types/api/dmmGamePlayer/Api.js';
import type * as IParadeApi from '../types/api/parade/Api.js';
import api from '../utils/api/index.js';
import argvUtils from '../utils/argv.js';
import config from '../utils/config.js';
import logger from '../utils/logger.js';

const networkQueue = new PQueue({ concurrency: config.threadCount.network });

interface StoredData<T> {
  req: any;
  rsp: T;
  updatedAt: string;
}

const diffIgnoreRules = [['server_time'], ['transaction_id']].map((e) => ({ path: ['rsp', ...e] }));

function getObjectDiff(
  obj1: any,
  obj2: any,
  ignoreRules: { path: string[]; pattern?: RegExp }[] = [],
  currentPath: string[] = [],
) {
  const diff: any = {};
  const keys = new Set([...Object.keys(obj1 || {}), ...Object.keys(obj2 || {})]);

  for (const key of keys) {
    const val1 = obj1?.[key];
    const val2 = obj2?.[key];
    const fullPath = [...currentPath, key];

    if (JSON.stringify(val1) === JSON.stringify(val2)) continue;

    const rule = ignoreRules.find(
      (r) => r.path.length === fullPath.length && r.path.every((p, i) => p === '*' || p === fullPath[i]),
    );

    if (rule) {
      if (!rule.pattern) continue;
      if (typeof val1 === 'string' && typeof val2 === 'string') {
        const normalized1 = val1.replace(rule.pattern, '');
        const normalized2 = val2.replace(rule.pattern, '');
        if (normalized1 === normalized2) continue;
      }
    }

    if (typeof val1 === 'object' && val1 !== null && typeof val2 === 'object' && val2 !== null) {
      const nestedDiff = getObjectDiff(val1, val2, ignoreRules, fullPath);
      if (Object.keys(nestedDiff).length > 0) diff[key] = nestedDiff;
    } else {
      diff[key] = { old: val1, new: val2 };
    }
  }
  return diff;
}

async function saveResultWithHistory<T>(
  subPaths: string[],
  version: string | null,
  data: { req: any; rsp: T },
  options: {
    saveLatest?: boolean;
    ignoreRules?: { path: string[]; pattern?: RegExp }[];
    allFileName?: string;
  } = {},
) {
  const { saveLatest = true, ignoreRules = [], allFileName = 'all.json' } = options;
  const outputDir = argvUtils.getArgv()['outputDir'];
  const filePathBase = path.join(outputDir, ...subPaths);
  const dataStr = JSON.stringify(data, null, 2);

  // 1. Save v{version}.json and latest.json if changed
  const filesToCheck: string[] = [];
  if (version) filesToCheck.push(path.join(filePathBase, `v${version}.json`));
  if (saveLatest) filesToCheck.push(path.join(filePathBase, 'latest.json'));

  for (const filePath of filesToCheck) {
    const file = Bun.file(filePath);
    if (!(await file.exists())) {
      await Bun.write(filePath, dataStr);
    } else {
      const currentData = await file.json();
      const diff = getObjectDiff(currentData, data, ignoreRules);
      if (Object.keys(diff).length > 0) {
        logger.trace(`Diff detected in ${filePath}:`, JSON.stringify(diff, null, 2));
        await Bun.write(filePath, dataStr);
      }
    }
  }

  // 2. Update all.json history
  const allFilePath = path.join(filePathBase, allFileName);
  const allFile = Bun.file(allFilePath);
  let allData: StoredData<T>[] = (await allFile.exists()) ? await allFile.json() : [];

  const exists = allData.some((e) => {
    const diff = getObjectDiff({ req: e.req, rsp: e.rsp }, data, ignoreRules);
    return Object.keys(diff).length === 0;
  });

  if (!exists) {
    allData.push({ updatedAt: DateTime.now().toISO(), ...data });
    await Bun.write(allFilePath, JSON.stringify(allData, null, 2));
    return true; // was updated
  }
  return false;
}

async function fetchAndSaveGetUrlCmd() {
  logger.debug('Fetching GetUrl.do ...');
  const dgpGameInfoAllPath = path.join(argvUtils.getArgv()['outputDir'], 'parade', 'dmm_game_info', 'all.json');
  const dgpGameInfoAll: StoredData<TypesApiDgp.InfoRspSanitized>[] = await Bun.file(dgpGameInfoAllPath).json();
  let isLatestWrote = false;
  for (const dgpEntry of dgpGameInfoAll.toReversed()) {
    const ver = semver.coerce(dgpEntry.rsp.info.latest_version);
    if (!ver) {
      logger.warn('Failed to parse DGP game version as semver: ' + dgpEntry.rsp.info.latest_version);
      continue;
    }
    const rsp = await api.parade.common.getUrl(ver.version, 4);
    if (!rsp.asset_bundle_url) continue;
    await saveResultWithHistory(
      ['parade', 'common', 'get_url'],
      ver.version,
      { req: { version: ver.version, platform: 4 }, rsp },
      { saveLatest: Boolean(!isLatestWrote), ignoreRules: diffIgnoreRules },
    );
    isLatestWrote = true;
  }
}

async function fetchAndSaveMst() {
  logger.debug('Fetching MstVersion.do ...');
  const verRsp = await api.parade.common.mstVersion();
  if (!verRsp.mst_ver && verRsp.error_code && verRsp.error_code.id === 11) {
    logger.warn('Game server is currently undergoing maintenance. Skipped');
    return;
  }
  if (!verRsp.mst_ver || verRsp.mst_ver.length === 0) {
    logger.warn('mst_ver is falsy. Skipped');
    return;
  }
  const isMstChanged = await saveResultWithHistory(
    ['parade', 'common', 'mst_version'],
    null,
    { req: {}, rsp: verRsp },
    { saveLatest: true, ignoreRules: diffIgnoreRules },
  );

  if (isMstChanged === false) return;

  logger.debug('Fetching MstData.do ...');
  const dataRspArr: (IParadeApi.MstVersionResponse['mst_ver'][number] & { data: string })[] = [];
  for (const typeEntry of verRsp.mst_ver.sort((a, b) => a.type.localeCompare(b.type))) {
    const rsp = await api.parade.common.mstData(typeEntry.type);
    if (!rsp.data) {
      logger.warn('MstData is falsy. Skipped: ' + typeEntry.version + ', ' + typeEntry.type);
      continue;
    }
    logger.trace('Fetched MstData: ' + typeEntry.version + ', ' + typeEntry.type);
    dataRspArr.push({ ...typeEntry, data: rsp.data });
  }
  await saveResultWithHistory(
    ['parade', 'common', 'mst_data'],
    null,
    { req: {}, rsp: dataRspArr },
    { saveLatest: true, ignoreRules: diffIgnoreRules },
  );

  logger.debug('Decoding MstData ...');
  {
    const apiLatestPath = path.join(argvUtils.getArgv()['outputDir'], 'parade', 'common', 'mst_data', 'latest.json');
    const apiLatestData: { req: {}; rsp: (IParadeApi.MstVersionResponse['mst_ver'][number] & { data: string })[] } =
      await Bun.file(apiLatestPath).json();
    const rootPath = path.join(argvUtils.getArgv()['outputDir'], 'parade', 'common', 'mst_data_raw_latest');
    for (const entry of apiLatestData.rsp) {
      const outPath = path.join(rootPath, entry.type + '.json');
      const data = new TextDecoder().decode(Bun.gunzipSync(Buffer.from(entry.data, 'base64')));
      await Bun.write(outPath, JSON.stringify(JSON.parse(data), null, 2));
      logger.trace('Decoded MstData: ' + entry.version + ', ' + entry.type);
    }
  }
}

async function downloadRawFile(url: string) {
  const urlObj = new URL(url);
  urlObj.search = '';
  const localPath = path.join(
    argvUtils.getArgv()['outputDir'],
    'raw',
    urlObj.hostname,
    ...urlObj.pathname.split('/').filter(Boolean),
  );

  if (await Bun.file(localPath).exists()) return false;

  try {
    const data = await ky.get(urlObj.href, api.parade.defaultSettings.ky).bytes();
    await Bun.write(localPath, data);
    return true;
  } catch (err) {
    if (err instanceof HTTPError && (err.response.status === 404 || err.response.status === 403)) return false;
    throw err;
  }
}

async function fetchAndSaveRawFile() {
  logger.debug('Fetching raw files ...');
  const wroteFiles: string[] = [];
  const outputDir = argvUtils.getArgv()['outputDir'];

  const addToQueue = (url: string) => {
    networkQueue.add(async () => {
      if (await downloadRawFile(url)) {
        wroteFiles.push(url);
      }
    });
  };

  const urls = new Set<string>();

  const platforms = ['Windows', 'Android', 'iOS'] as const;
  const fileNames = ['ab_list.txt', 'ab_env.txt', 'ab_guid.txt', 'filesize.csv'];
  const getUrlRspAllPath = path.join(outputDir, 'parade', 'common', 'get_url', 'all.json');
  const getUrlRspAll: StoredData<IParadeApi.GetUrlResponse>[] = await Bun.file(getUrlRspAllPath).json();
  for (const getUrlRspEntry of getUrlRspAll) {
    for (const platform of platforms) {
      for (const fName of fileNames) {
        urls.add(
          `${getUrlRspEntry.rsp.asset_bundle_url}/${platform}/${getUrlRspEntry.rsp.asset_bundle_version}/ja/${fName}`,
        );
      }
    }
  }
  for (const url of urls) addToQueue(url);
  await networkQueue.onIdle();

  for (const url of wroteFiles.filter((e) => e.includes('ab_list.txt'))) {
    const urlObj = new URL(url);
    urlObj.search = '';
    const localPath = path.join(
      argvUtils.getArgv()['outputDir'],
      'raw',
      urlObj.hostname,
      ...urlObj.pathname.split('/').filter(Boolean),
    );
    const rawData = await Bun.file(localPath).text();
    const parsedData = parseAbList(rawData);
    await Bun.write(localPath.replace(/\.txt$/, '.json'), JSON.stringify(parsedData, null, 2));
  }

  logger.info(`Fetched raw files: ${wroteFiles.length} files`);
}

function parseAbList(text: string): IParadeApi.ABListData {
  const lines = text.split(/\r?\n/);

  if (lines.length === 0) throw new Error('Text is empty');

  const version = lines.shift() || '';
  const dataList: IParadeApi.ABListAssetData[] = [];

  for (const line of lines) {
    if (line.startsWith('[EOF]')) break;
    if (!line) continue;

    const cols = line.split('\t');
    if (cols.length <= 7) throw new Error('Cannot parse ab_list.txt: not enough cols length: ' + cols.length);
    const data: IParadeApi.ABListAssetData = {
      name: cols[0]!,
      save: cols[1]! === '1',
      type: cols[2]! as IParadeApi.ABListAssetData['type'],
      category: cols[3]!,
      tags: cols[4]!.split(','),
      size: parseInt(cols[5]!),
      hash: !isNaN(parseInt(cols[6]!, 16)) ? cols[6]! : '',
      dependencies: cols[7]!
        .split(',')
        .map((val) => parseInt(val, 10))
        .filter(Boolean),
    };
    dataList.push(data);
  }

  return { version: version, items: dataList };
}

async function main() {
  await fetchAndSaveGetUrlCmd();
  await fetchAndSaveMst();
  await fetchAndSaveRawFile();
}

export default main;
