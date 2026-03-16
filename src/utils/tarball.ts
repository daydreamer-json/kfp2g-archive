import tar from 'tar-stream';
import logger from './logger.js';
import mathUtils from './math.js';

async function createTar(files: { path: string; buffer: ArrayBuffer }[]): Promise<Buffer> {
  logger.info('Creating tarball buffer ...');
  const pack = tar.pack();
  const chunks: Uint8Array[] = [];

  const streamPromise = new Promise<Buffer>((resolve, reject) => {
    pack.on('data', (chunk: Uint8Array) => chunks.push(chunk));
    pack.on('end', () => resolve(Buffer.concat(chunks)));
    pack.on('error', reject);
  });

  for (const file of files) {
    const uint8 = new Uint8Array(file.buffer);
    await new Promise<void>((resolve, reject) => {
      const entry = pack.entry({ name: file.path, size: uint8.length }, (err) => {
        if (err) reject(err);
        else resolve();
      });
      entry.write(uint8);
      entry.end();
    });
  }

  pack.finalize();
  return streamPromise;
}

async function createTarZstd(files: { path: string; buffer: ArrayBuffer }[]): Promise<Buffer> {
  const tarBuf = await createTar(files);
  logger.info(
    'Created tarball buffer: ' +
      mathUtils.formatFileSize(tarBuf.byteLength, {
        decimals: 2,
        decimalPadding: true,
        useBinaryUnit: true,
        useBitUnit: false,
        unitVisible: true,
        unit: 'M',
      }),
  );
  const LEVEL = 12;
  logger.info('Compressing tarball buffer with zstd level=' + LEVEL + ' ...');
  const zstdBuf = await Bun.zstdCompress(tarBuf, { level: LEVEL });
  logger.info(
    'Compressed tarball buffer: ' +
      mathUtils.formatFileSize(zstdBuf.byteLength, {
        decimals: 2,
        decimalPadding: true,
        useBinaryUnit: true,
        useBitUnit: false,
        unitVisible: true,
        unit: 'M',
      }),
  );
  Bun.gc(true);
  return zstdBuf;
}

export default {
  createTar,
  createTarZstd,
};
