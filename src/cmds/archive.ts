import path from 'node:path';
import { Octokit } from '@octokit/rest';
import ky from 'ky';
import { DateTime } from 'luxon';
import PQueue from 'p-queue';
import semver from 'semver';
import * as TypesApiDgp from '../types/api/dmmGamePlayer/Api.js';
import type * as IParadeApi from '../types/api/parade/Api.js';
import api from '../utils/api/index.js';
import argvUtils from '../utils/argv.js';
import config from '../utils/config.js';
import configAuth from '../utils/configAuth.js';
import github from '../utils/github.js';
import logger from '../utils/logger.js';
import mathUtils from '../utils/math.js';
import tarball from '../utils/tarball.js';

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

async function validateDGPAccessToken(): Promise<boolean> {
  if (configAuth.get().dmm.accessToken !== null) {
    const rsp = await api.dmmGamePlayer.auth.accesstoken.check(configAuth.get().dmm.accessToken!);
    if (rsp.data.result) {
      logger.trace('DMM Game Player access token is valid');
      return true;
    } else {
      await configAuth.set({ ...configAuth.get(), dmm: { ...configAuth.get().dmm, accessToken: null } });
      logger.warn('DMM Game Player access token is invalid or expired');
      return false;
    }
  }
  return false;
}

async function dlGameFile(fileList: TypesApiDgp.Filelist['data'], signCookie: string) {
  logger.info('Downloading game file ...');
  const outArr: (TypesApiDgp.Filelist['data']['file_list'][number] & { buffer: ArrayBuffer })[] = [];
  const netQueue = new PQueue({ concurrency: config.threadCount.network });
  for (const fileEntry of fileList.file_list.sort((a, b) => a.size - b.size)) {
    const url = fileList.domain + '/' + fileEntry.path;
    netQueue.add(async () => {
      const rsp = await ky
        .get(url, {
          ...api.dmmGamePlayer.defaultSettings.ky,
          headers: { ...api.dmmGamePlayer.defaultSettings.ky.headers, Cookie: signCookie },
        })
        .arrayBuffer();
      outArr.push({
        ...fileEntry,
        buffer: rsp,
      });
      logger.trace(
        `Downloaded: ${fileEntry.local_path} (${mathUtils.formatFileSize(fileEntry.size, { decimals: 2, decimalPadding: true, useBinaryUnit: true, useBitUnit: false, unitVisible: true, unit: 'M' })})`,
      );
    });
  }
  await netQueue.onIdle();
  return outArr;
}

async function fetchAndArchiveGamePkg() {
  const octoClient = new Octokit({ auth: configAuth.get().github.relArchive.token });

  logger.debug('Fetching DGP game info ...');
  const reqParam = {
    productId: config.network.api.dmm.productId,
    gameType: config.network.api.dmm.gameType,
    launchType: config.network.api.dmm.launchType,
  };

  const dgpLaunchRsp = await api.dmmGamePlayer.r2.launch.cl(
    configAuth.get().dmm.accessToken!,
    reqParam.productId,
    reqParam.gameType,
    reqParam.launchType,
  );
  if (dgpLaunchRsp.result_code !== 100) throw new Error('API error');
  if (configAuth.get().dmm.viewerId === null) {
    const viewerId = dgpLaunchRsp.data.execute_args.match(/\/viewer_id=(\d+)/);
    if (viewerId && viewerId[1]) {
      configAuth.set({
        ...configAuth.get(),
        dmm: {
          ...configAuth.get().dmm,
          viewerId: parseInt(viewerId[1]),
        },
      });
      logger.info('Valid DMM viewer ID detected. Wrote to configAuth: ' + viewerId[1]);
    }
  }

  const dgpFilelistRsp = await api.dmmGamePlayer.getFilelist(
    configAuth.get().dmm.accessToken!,
    dgpLaunchRsp.data.file_list_url,
  );
  if (dgpFilelistRsp.result_code !== 100) throw new Error('API error');
  const rspSanitized = {
    info: {
      product_id: dgpLaunchRsp.data.product_id,
      title: dgpLaunchRsp.data.title,
      exec_file_name: dgpLaunchRsp.data.exec_file_name,
      install_dir: dgpLaunchRsp.data.install_dir,
      file_list_url: dgpLaunchRsp.data.file_list_url,
      is_administrator: dgpLaunchRsp.data.is_administrator,
      file_check_type: dgpLaunchRsp.data.file_check_type,
      total_size: dgpLaunchRsp.data.total_size,
      latest_version: dgpLaunchRsp.data.latest_version,
      conversion_url: dgpLaunchRsp.data.conversion_url,
    },
    fileList: dgpFilelistRsp.data,
  };
  logger.info(
    `Fetched DGP game info: v${rspSanitized.info.latest_version}, ${rspSanitized.fileList.file_list.length} files`,
  );
  const isChanged = await saveResultWithHistory(['parade', 'dmm_game_info'], null, {
    req: reqParam,
    rsp: rspSanitized,
  });
  const dgpPkgMirrorListPath = path.join(
    argvUtils.getArgv()['outputDir'],
    'parade',
    'dmm_game_files',
    'mirror_file_list.json',
  );
  const dgpPkgMirrorList: { version: string; mirror: string }[] = await Bun.file(dgpPkgMirrorListPath).json();
  if (isChanged || !dgpPkgMirrorList.find((e) => e.version === rspSanitized.info.latest_version)) {
    const gameFiles = await dlGameFile(rspSanitized.fileList, dgpLaunchRsp.data.sign);
    const tarZstdBuf = await tarball.createTarZstd(
      gameFiles.map((e) => ({ path: e.local_path.replace(/^\//, ''), buffer: e.buffer })),
    );
    Bun.gc(true);
    await github.uploadAssetFromBuffer(octoClient, tarZstdBuf, `v${rspSanitized.info.latest_version}.tar.zst`);
    dgpPkgMirrorList.push({
      version: rspSanitized.info.latest_version,
      mirror: `https://github.com/${configAuth.get().github.relArchive.owner}/${configAuth.get().github.relArchive.repo}/releases/download/${configAuth.get().github.relArchive.tag}/v${rspSanitized.info.latest_version}.tar.zst`,
    });
    await Bun.write(dgpPkgMirrorListPath, JSON.stringify(dgpPkgMirrorList));
  }
}

async function fetchAndSaveGetUrlCmd() {
  logger.debug('Fetching GetUrl.do ...');
  const dgpGameInfoAllPath = path.join(argvUtils.getArgv()['outputDir'], 'parade', 'dmm_game_info', 'all.json');
  const dgpGameInfoAll: StoredData<TypesApiDgp.InfoRspSanitized>[] = await Bun.file(dgpGameInfoAllPath).json();
  for (const dgpEntry of dgpGameInfoAll) {
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
      { saveLatest: true, ignoreRules: diffIgnoreRules },
    );
  }
}

async function fetchAndSaveMst() {
  logger.debug('Fetching MstVersion.do ...');
  const verRsp = await api.parade.common.mstVersion();
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
      await Bun.write(outPath, data);
      logger.trace('Decoded MstData: ' + entry.version + ', ' + entry.type);
    }
  }
}

async function main() {
  // validate dmm access token
  await validateDGPAccessToken();

  if (configAuth.get().dmm.accessToken !== null) {
    await fetchAndArchiveGamePkg();
  }

  await fetchAndSaveGetUrlCmd();
  await fetchAndSaveMst();
}

export default main;
