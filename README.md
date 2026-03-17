<h1 align="center">kfp2g-archive</h2>

<p align="center">
  <a href="https://github.com/daydreamer-json/kfp2g-archive/actions/workflows/main.yml"><img src="https://github.com/daydreamer-json/kfp2g-archive/actions/workflows/main.yml/badge.svg" alt="GitHub Actions" /></a>
  <img src="https://api.cron-job.org/jobs/7382488/97c863abd6fbf221/status-0.svg" alt="Cron Job" />
</p>

Monitor changes to responses from various APIs of a certain anime game for kemono fans and record them in this repository.

Updates are checked about every 10 minutes and automatically pushed by GitHub Actions.  
API outputs are stored in the [`output`](/output/) directory.

The APIs currently being monitored are as follows:
- [Game packages info](output/parade/dmm_game_info/)
  - [Game packages (mirror)](output/parade/dmm_game_files/mirror_file_list.json)
- In-game APIs
  - [Get URL](output/parade/common/get_url/)
  - Master data table ([Raw](output/parade/common/mst_data/), [Latest Decoded](output/parade/common/mst_data_raw_latest/))
- [Assetbundles](output/parade/ab/)
  - Due to the large number of files and total size, the data is split into chunks of approximately 1GiB (uncompressed) and stored as Zstd-compressed tarballs.
- [Raw data](output/raw/)

## Contributing

Contributions are welcome! If you would like to help improve the code or have encountered any issues, please feel free to open an issue or submit a pull request.

## Disclaimer

This project is not affiliated with any other company and was created solely for **private use, educational, and research purposes.**  
Copyright for the archived source code and binary data belongs to their respective copyright holders.

I assume no responsibility whatsoever. **PLEASE USE IT AT YOUR OWN RISK.**

---

This project was created using `bun init` in bun v1.3.9. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
