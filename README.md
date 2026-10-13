# 波克风格网络测速 · Boke Speedtest

基于 LibreSpeed 的网络测速与稳定性测试页面，提供波克风格背景、品牌图标、双测速仪表盘和适配手机的布局。

- 下载、上传、延迟、抖动测试；初始读数为 `0.00`。
- 稳定性测试、延迟曲线和 CSV 导出。
- 自动跟随波克官网的背景视频、封面、Logo、浏览器图标和主题色；保留现有布局和仪表盘。
- 默认每 5 分钟检查，测速期间停止背景视频和主题请求；官网不可用时保留已有素材。
- 默认使用部署服务器作为测速节点，关闭遥测，无需数据库。

## 直接使用发布镜像

公开镜像：[`ghcr.io/rumij/boke-speedtest`](https://github.com/rumij/boke-speedtest/pkgs/container/boke-speedtest)

```bash
docker run -d --name boke-speedtest --restart unless-stopped -p 127.0.0.1:18088:8080 ghcr.io/rumij/boke-speedtest:1.1.0
```

打开 [http://localhost:18088](http://localhost:18088)。稳定性测试位于 `/stability.html`。

也可以下载本仓库 [compose.yaml](compose.yaml)，在同目录执行：

```bash
docker compose pull
docker compose up -d
```

**完整部署、局域网访问、NAS/容器平台设置、更新和故障排查：[部署文档](docs/DEPLOY.md)**。

发布平台为 `linux/amd64`（Intel/AMD 64 位，Windows/macOS 使用 Linux 容器）。`1.1.0` 为固定版本，`latest` 跟随稳定发行版，`edge` 跟随 main 分支。

## 本地修改与发布

本地挂载源码预览见 [LOCAL_TEST.md](LOCAL_TEST.md)。使用正式 Dockerfile 构建：

```bash
docker build -t boke-speedtest:local .
docker run -d --name boke-speedtest-dev -p 127.0.0.1:18090:8080 boke-speedtest:local
```

GitHub Actions 在 main 分支更新时构建并验证容器，验证通过后发布 `edge` 和提交号标签；推送 `v1.1.0` 这类版本标签时发布对应镜像版本及 `latest`。自动化流程见 [.github/workflows/docker-publish.yml](.github/workflows/docker-publish.yml)。首次创建 GHCR 包后需将包的 Visibility 设为 Public（仓库公开并不自动令包公开）。

发布检查使用 `npm ci`、`npx playwright install chromium`、`npm run test:release`、`npm run test:theme`，针对 `http://127.0.0.1:18090` 上已启动的容器运行。它会执行短时本机测速、停止/重新测速和稳定性采样；结果用于功能验证，不代表互联网带宽。旧上游测试套件保留在 `tests/e2e/`，包含上游原始界面断言。

## 来源与许可

源码沿用 LibreSpeed 的 **LGPL-3.0-or-later**，保留原作者声明。品牌图标、视频和图片有独立权利归属，见 [NOTICE.md](NOTICE.md) 与 [素材来源](frontend/images/boke/SOURCES.txt)。本项目不是波克官方产品。
