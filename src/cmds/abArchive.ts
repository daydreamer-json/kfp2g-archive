import path from 'node:path';
import { Octokit } from '@octokit/rest';
import ky from 'ky';
import PQueue from 'p-queue';
import type * as IParadeApi from '../types/api/parade/Api.js';
import api from '../utils/api/index.js';
import argvUtils from '../utils/argv.js';
import config from '../utils/config.js';
import configAuth from '../utils/configAuth.js';
import github from '../utils/github.js';
import logger from '../utils/logger.js';
import mathUtils from '../utils/math.js';
import tarball from '../utils/tarball.js';

const networkQueue = new PQueue({ concurrency: config.threadCount.network });

interface StoredData<T> {
  req: any;
  rsp: T;
  updatedAt: string;
}

const defaultSizeFmtCfg = {
  decimals: 2,
  decimalPadding: true,
  useBinaryUnit: true,
  useBitUnit: false,
  unitVisible: true,
  unit: 'M' as const,
};

const MAX_CHUNK_SIZE = 1 * 1024 * 1024 * 1024;

async function main() {
  logger.info('Downloading latest assetbundles and creating tarball zstd chunks ...');

  networkQueue.concurrency *= 2;

  const platforms = ['Windows', 'Android', 'iOS'] as const;
  const lang = 'ja';

  const octoClient = new Octokit({ auth: configAuth.get().github.relArchive.token });

  if (await github.checkIsActionRunning()) {
    logger.error('Duplicate execution detected (GitHub Action is already running)');
    return;
  }

  const outputDir = argvUtils.getArgv()['outputDir'];

  const abMirrorListPath = path.join(outputDir, 'parade', 'ab', 'mirror_list.json');
  const abMirrorListData: IParadeApi.ABMirrorArchiveEntry[] = await Bun.file(abMirrorListPath).json();

  const getUrlPath = path.join(outputDir, 'parade', 'common', 'get_url', 'all.json');
  const getUrlData: StoredData<IParadeApi.GetUrlResponse>[] = await Bun.file(getUrlPath).json();
  const latestGetUrlRsp = getUrlData.at(-1)!.rsp;
  const abUrlBaseLastPath = new URL(latestGetUrlRsp.asset_bundle_url).pathname.split('/').filter(Boolean).at(-1);

  for (const platform of platforms) {
    if (
      abMirrorListData.find(
        (e) =>
          e.assetBundleUrl === latestGetUrlRsp.asset_bundle_url &&
          e.assetBundleVersion === latestGetUrlRsp.asset_bundle_version &&
          e.platform === platform,
      )
    ) {
      continue;
    }
    const abListPath = (() => {
      const urlObj = new URL(latestGetUrlRsp.asset_bundle_url);
      return path.join(
        outputDir,
        'raw',
        urlObj.hostname,
        ...urlObj.pathname.split('/').filter(Boolean),
        platform,
        latestGetUrlRsp.asset_bundle_version,
        lang,
        'ab_list.json',
      );
    })();
    const abListData: IParadeApi.ABListData = await Bun.file(abListPath).json();
    const sortedItems = abListData.items.sort((a, b) => a.name.localeCompare(b.name));
    const chunks: IParadeApi.ABListData['items'][] = [];
    let currentChunk: IParadeApi.ABListData['items'] = [];
    let currentChunkSize = 0;

    for (const item of sortedItems) {
      if (currentChunkSize + item.size > MAX_CHUNK_SIZE && currentChunk.length > 0) {
        chunks.push(currentChunk);
        currentChunk = [];
        currentChunkSize = 0;
      }
      currentChunk.push(item);
      currentChunkSize += item.size;
    }
    if (currentChunk.length > 0) chunks.push(currentChunk);

    logger.info(
      `Downloading: v${abUrlBaseLastPath}, ${platform}, ${abListData.items.length} files, ${chunks.length} chunks, ${mathUtils.formatFileSize(mathUtils.arrayTotal(sortedItems.map((e) => e.size)), defaultSizeFmtCfg)}, ${networkQueue.concurrency} threads`,
    );

    const mapping: Record<string, string[]> = {};
    let processedFiles = 0;

    const chunkMapFileName = `ab_${abUrlBaseLastPath}_${platform}_${latestGetUrlRsp.asset_bundle_version}_chunk_map.json`;

    for (let i = 0; i < chunks.length; i++) {
      let dledFileSize = 0;
      const chunkItems = chunks[i]!;
      const chunkFileName = `ab_${abUrlBaseLastPath}_${platform}_${latestGetUrlRsp.asset_bundle_version}_chunk_${i}.tar.zst`;
      mapping[chunkFileName] = chunkItems.map((item) => item.name);

      logger.info(`Processing chunk: ${i + 1} / ${chunks.length}, ${chunkItems.length} files ...`);

      const fileBuffers: { path: string; buffer: ArrayBuffer }[] = [];

      for (const item of chunkItems) {
        const url = [
          latestGetUrlRsp.asset_bundle_url,
          platform,
          latestGetUrlRsp.asset_bundle_version,
          lang,
          'assets',
          item.name,
        ].join('/');
        networkQueue.add(async () => {
          const rsp = await ky.get(url, api.parade.defaultSettings.ky).arrayBuffer();
          fileBuffers.push({ path: item.name, buffer: rsp });
          processedFiles++;
          dledFileSize += item.size;
          process.stdout.write('\x1b[1A\x1b[2K');
          logger.trace(
            `Downloaded files: ${mathUtils.formatFileSize(dledFileSize, { ...defaultSizeFmtCfg, unitVisible: false })} / ${mathUtils.formatFileSize(mathUtils.arrayTotal(chunkItems.map((e) => e.size)), defaultSizeFmtCfg)}, ${item.name}`,
          );
        });
      }
      await networkQueue.onIdle();

      const tarZstdBuffer = await tarball.createTarZstd(fileBuffers);
      Bun.gc(true);

      await github.uploadAssetFromBuffer(octoClient, tarZstdBuffer, chunkFileName);
      Bun.gc(true);
    }

    const mappingPath = path.join(outputDir, 'parade', 'ab', chunkMapFileName);
    await Bun.write(mappingPath, JSON.stringify(mapping, null, 2));
    abMirrorListData.push({
      assetBundleUrl: latestGetUrlRsp.asset_bundle_url,
      assetBundleVersion: latestGetUrlRsp.asset_bundle_version,
      platform,
      chunkMapFile: chunkMapFileName,
      chunkMapBaseName: `https://github.com/${configAuth.get().github.relArchive.owner}/${configAuth.get().github.relArchive.repo}/releases/download/${configAuth.get().github.relArchive.tag}`,
    });
    await Bun.write(abMirrorListPath, JSON.stringify(abMirrorListData, null, 2));
  }

  networkQueue.concurrency /= 2;

  logger.info('All processes completed successfully.');
}

export default main;
