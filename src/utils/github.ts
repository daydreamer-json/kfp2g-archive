import { Octokit } from '@octokit/rest';
import ky from 'ky';
import config from './config.js';
import configAuth from './configAuth.js';
import logger from './logger.js';

async function uploadAsset(client: Octokit | null, url: string, targetFileName: string | null) {
  if (!client) return;
  const authCfg = configAuth.get();
  const release = await getReleaseInfo(client);
  if (!release) throw new Error('GH release not found');
  const releaseId = release.id;

  logger.info(`Mirror archive: Downloading ${new URL(url).pathname.split('/').pop()} ...`);
  const name = targetFileName ?? new URL(url).pathname.split('/').pop() ?? '';
  const bin: Uint8Array = await ky.get(url, { headers: { 'User-Agent': config.network.userAgent.minimum } }).bytes();
  const binSize: number = bin.byteLength;
  logger.info(`Mirror archive: Uploading ${new URL(url).pathname.split('/').pop()} ...`);
  await client.rest.repos.uploadReleaseAsset({
    owner: authCfg.github.relArchive.owner,
    repo: authCfg.github.relArchive.repo,
    release_id: releaseId,
    name,
    data: bin as any,
    headers: { 'content-length': binSize },
  });
}

async function uploadAssetFromBuffer(client: Octokit | null, buffer: Buffer, targetFileName: string) {
  if (!client) return;
  const authCfg = configAuth.get();
  const release = await getReleaseInfo(client);
  if (!release) throw new Error('GH release not found');
  const releaseId = release.id;

  const binSize: number = buffer.byteLength;
  logger.info(`Mirror archive: Uploading ${targetFileName} ...`);
  await client.rest.repos.uploadReleaseAsset({
    owner: authCfg.github.relArchive.owner,
    repo: authCfg.github.relArchive.repo,
    release_id: releaseId,
    name: targetFileName,
    data: buffer as any,
    headers: { 'content-length': binSize },
  });
}

async function getReleaseInfo(client: Octokit | null) {
  if (!client) return;
  const authCfg = configAuth.get();
  const { data: release } = await client.rest.repos.getReleaseByTag({
    owner: authCfg.github.relArchive.owner,
    repo: authCfg.github.relArchive.repo,
    tag: authCfg.github.relArchive.tag,
  });
  return release;
}

async function checkIsActionRunning(): Promise<boolean> {
  const authCfg = configAuth.get();
  logger.debug('Checking GitHub Actions running status ...');
  const client = new Octokit({ auth: authCfg.github.main.token });
  const data = await client.rest.actions.listWorkflowRunsForRepo({
    owner: authCfg.github.main.owner,
    repo: authCfg.github.main.repo,
  });
  return data.data.workflow_runs.filter((e) => e.status === 'in_progress').length > 1;
}

export default {
  uploadAsset,
  uploadAssetFromBuffer,
  getReleaseInfo,
  checkIsActionRunning,
};
