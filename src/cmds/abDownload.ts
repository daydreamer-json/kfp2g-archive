import path from 'node:path';
import ky from 'ky';
import prompts from 'prompts';
import type * as IParadeApi from '../types/api/parade/Api.js';
import argvUtils from '../utils/argv.js';
import config from '../utils/config.js';
import exitUtils from '../utils/exit.js';
import logger from '../utils/logger.js';
import mathUtils from '../utils/math.js';
import tarball from '../utils/tarball.js';

const defaultSizeFmtCfg = {
  decimals: 2,
  decimalPadding: true,
  useBinaryUnit: true,
  useBitUnit: false,
  unitVisible: true,
  unit: 'M' as const,
};

async function main() {
  const outputDir = argvUtils.getArgv()['outputDir'];
  const outputDirAb = argvUtils.getArgv()['outputDirAb'];
  const regexStrings = argvUtils.getArgv()['regex'] as string[];
  const regexes = regexStrings.map((s) => new RegExp(s));

  const abMirrorListData: IParadeApi.ABMirrorArchiveEntry[] = await Bun.file(
    path.join(outputDir, 'parade', 'ab', 'mirror_list.json'),
  ).json();

  const selectedAbMirror = (
    await prompts(
      {
        name: 'value',
        type: 'select',
        message: 'Select target assetbundle set',
        choices: abMirrorListData.map((e) => ({
          title: `${new URL(e.assetBundleUrl).pathname.split('/').filter(Boolean).at(-1)}, v${e.assetBundleVersion}, ${e.platform}`,
          value: e,
        })),
      },
      {
        onCancel: () => {
          logger.error('Aborted');
          exitUtils.exit(1, null, false);
        },
      },
    )
  ).value as IParadeApi.ABMirrorArchiveEntry;

  const chunkMapData: Record<string, string[]> = await Bun.file(
    path.join(outputDir, 'parade', 'ab', selectedAbMirror.chunkMapFile),
  ).json();

  const chunkEntries = Object.entries(chunkMapData);
  let totalSavedFiles = 0;

  for (const [chunkFileName, fileNames] of chunkEntries) {
    const matchingFiles = fileNames.filter((name) => regexes.some((re) => re.test(name)));
    if (matchingFiles.length === 0) continue;

    logger.info(`Processing chunk: ${chunkFileName} (${matchingFiles.length} / ${fileNames.length} files match) ...`);

    const downloadUrl = `${selectedAbMirror.chunkMapBaseName}/${chunkFileName}`;
    const chunkBuffer = await ky
      .get('https://ghfast.top/' + downloadUrl, { headers: { 'User-Agent': config.network.userAgent.chromeWindows } })
      .arrayBuffer();

    const extractedFiles = await tarball.extractTarZstd(chunkBuffer);
    Bun.gc(true);

    for (const file of extractedFiles) {
      if (regexes.some((re) => re.test(file.path))) {
        const outputPath = path.join(outputDirAb, file.path);
        await Bun.write(outputPath, file.buffer);
        logger.trace(
          `Saved: ${file.path} (${mathUtils.formatFileSize(file.buffer.byteLength, { ...defaultSizeFmtCfg, unit: null })})`,
        );
        totalSavedFiles++;
      }
    }

    Bun.gc(true);
  }

  logger.info(`Done. Total saved files: ${totalSavedFiles}`);
}

export default main;
