type AuthAccesstokenCheck = {
  result_code: 100;
  data: { result: boolean };
  error: null;
};

type R2InstallCl = {
  result_code: 100;
  data: {
    product_id: string; // kfp2g
    title: string; // けものフレンズ3
    has_installer: boolean;
    installer: null | unknown;
    has_modules: boolean;
    modules: null | unknown;
    install_dir: string; // KFP2G
    file_list_url: string; // /gameplayer/filelist/35310
    is_administrator: boolean;
    file_check_type: 'FILELIST';
    total_size: number; // 383862447
    latest_version: string; // 2.37.1.0
    sdk_type: string; // mSDK_01
    sign: string; // long cookie string
  };
  error: null;
};
type R2LaunchCl = {
  result_code: 100;
  data: {
    product_id: string; // kfp2g
    title: string; // けものフレンズ3
    exec_file_name: string; // けもフレ３.exe
    install_dir: string; // KFP2G
    file_list_url: string; // /gameplayer/filelist/35310
    is_administrator: boolean;
    file_check_type: 'FILELIST';
    total_size: number; // 383862447
    latest_version: string; // 2.37.1.0
    execute_args: string; // /viewer_id=xxx /onetime_token=xxxx /access_token=xxxxx
    conversion_url: null;
    sign: string; // long cookie string
    access_token_info: {
      access_token: string; // actauth
      expires_in_seconds: number;
    };
  };
  error: null;
};

type Filelist = {
  result_code: 100;
  data: {
    domain: string;
    file_list: {
      local_path: string;
      path: string;
      size: number;
      hash: string;
      protected_flg: boolean;
      force_delete_flg: boolean;
      check_hash_flg: boolean;
      timestamp: number;
    }[];
    page: number;
  };
  error: null;
};

type InfoRspSanitized = {
  info: {
    product_id: string;
    title: string;
    exec_file_name: string;
    install_dir: string;
    file_list_url: string;
    is_administrator: boolean;
    file_check_type: 'FILELIST';
    total_size: number;
    latest_version: string;
    conversion_url: null;
  };
  fileList: {
    domain: string;
    file_list: {
      local_path: string;
      path: string;
      size: number;
      hash: string;
      protected_flg: boolean;
      force_delete_flg: boolean;
      check_hash_flg: boolean;
      timestamp: number;
    }[];
    page: number;
  };
};

export type { AuthAccesstokenCheck, R2InstallCl, R2LaunchCl, Filelist, InfoRspSanitized };
