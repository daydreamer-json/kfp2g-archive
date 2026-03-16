export interface ErrorCode {
  msg: string;
  tit: string;
  typ: number;
  id: number;
}

export interface Response {
  res_code: 0 | number;
  error_code: ErrorCode | null;
  client_wait: number;
  server_time: number;
  transaction_id: string;
}

export interface GetUrlResponse extends Response {
  asset_bundle_url: string;
  base_data_url: string;
  notice_url: string;
  asset_bundle_version: string;
  is_need_version_up: number;
  server_id: string;
  webview_url: string;
  maintenance: {
    title: string;
    text: string;
    link_address: string;
    link_type: number;
  } | null;
}

export interface MstVersionResponse extends Response {
  mst_ver: { type: string; version: string }[];
}
export interface MstDataResponse extends Response {
  data: string;
}

export interface ABListAssetData {
  name: string;
  save: boolean;
  type: 'Asset' | 'Raw' | 'AssetDirectory' | 'RawDirectory' | 'Pack' | 'PackEnd';
  category: string;
  tags: string[];
  size: number;
  hash: string;
  dependencies: number[];
}
export interface ABListData {
  version: string;
  items: ABListAssetData[];
}

export interface ABMirrorArchiveEntry {
  assetBundleUrl: string;
  assetBundleVersion: string;
  platform: 'Windows' | 'Android' | 'iOS';
  chunkMapFile: string;
  chunkMapBaseName: string;
}
