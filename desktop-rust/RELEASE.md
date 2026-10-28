# Rust macOS 正式版发布

Veymux 仅发布 Rust/Tauri macOS 客户端，要求 **macOS 14+、Apple Silicon**。
应用为 `Veymux.app`，Bundle ID 为 `com.jovines.veymux`，可执行文件为 `Veymux`。
桌面版本在 `desktop-rust/package.json`、lockfile 与 `src-tauri/tauri.conf.json` 中同步，
与根目录 npm CLI/服务端版本独立。不构建旧客户端或兼容升级包。

## 发布流程

1. 递增桌面三个版本文件，运行受影响回归、根构建与桌面检查，显式暂存路径并
   提交、推送。发布源须为干净且与 `origin/master` 一致的精确 SHA。
2. 用 `git archive HEAD` 将精确源码传入独立 Mac 构建目录；设置
   `VEYMUX_PREVIEW_SOURCE_REVISION` 与 `GITHUB_SHA` 为完整源码 SHA。
   在 Mac 私有环境中加载已有 Developer ID、Apple API 凭证及 Tauri updater 密钥，
   不将凭证写入仓库、命令参数或日志，不重新生成更新密钥。
3. 安装依赖，准备资源，运行原生与桥接测试，再构建正式包：

   ```sh
   npm ci --ignore-scripts
   npm ci --ignore-scripts --prefix desktop-rust
   npm --prefix desktop-rust run prepare:workspace
   npm --prefix desktop-rust run prepare:renderer
   cargo test --manifest-path desktop-rust/src-tauri/Cargo.toml --locked --lib
   node --test desktop-rust/renderer/*.test.mjs desktop-rust/scripts/*.test.mjs
   npm --prefix desktop-rust run package:stable -- VERSION /absolute/new/output
   python3 desktop-rust/scripts/notarize-preview.py /absolute/new/output \
     desktop-rust/src-tauri/target/release/bundle/macos/Veymux.app /absolute/build.log
   ```

   使用 `CARGO_TARGET_DIR` 时相应调整 App 路径。App 和最终 DMG 都必须获得
   Accepted 公证结果；staple 后验证 Gatekeeper、签名团队、版本、架构与 minOS 14。
   校验嵌入工作区 SHA、资源摘要、更新公钥和正式 endpoint；最终更新包签名必须
   对应同一份字节，DMG staple 后重算摘要。
4. 将最终产物传回独立目录，逐项比对摘要并删除临时 `build-config.json`。
   执行 `python3 desktop-rust/scripts/stage-release.py /absolute/artifacts`
   上传精确源码草稿。检查签名 App 的实际启动与安装路径后执行：

   ```sh
   STABLE_VERSION=VERSION STABLE_REVISION=完整SHA \
     python3 desktop-rust/scripts/promote-stable.py
   ```

5. 推广器核对标签、资产清单、size/SHA-256、公证记录和平台身份，先公开正式
   Release 并设 Latest，再更新 `stable-channel/latest.json`；拒绝替换已发布版本
   或回退渠道。最后从公开 URL 下载并核对 feed 与安装包。

## 正式 Release 资产

| 资产 | 用途 |
| --- | --- |
| `Veymux_VERSION_aarch64.dmg` | macOS 首次安装 |
| `Veymux-Rust-darwin-arm64-VERSION.zip` | 手动解压安装 |
| `Veymux_VERSION_aarch64.app.tar.gz` / `.sig` | 签名自动更新 |
| `latest.json` | 复制至正式更新渠道的 Tauri feed |
| `release.json` | 精确源码、公证收据及最终资产摘要 |

GUI 与服务独立更新；更新客户端不得停止服务或终端会话。源码测试、签名、公证、
实际安装和用户交互验收分别报告，不以构建通过代替公开可下载，也不以浏览器模拟
代替真实 macOS/iOS 验收。Rust Preview 使用独立身份和渠道；已有 Rust Preview
配置交接逻辑仍保持与正式版的信任隔离。
