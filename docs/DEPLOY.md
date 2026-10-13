# 容器部署

## 发布地址

| 项目 | 地址 |
| --- | --- |
| 源码 | https://github.com/rumij/boke-speedtest |
| GitHub Container Registry | https://github.com/rumij/boke-speedtest/pkgs/container/boke-speedtest |
| 固定版本镜像 | `ghcr.io/rumij/boke-speedtest:1.1.0` |
| 最新稳定版 | `ghcr.io/rumij/boke-speedtest:latest` |
| 开发版 | `ghcr.io/rumij/boke-speedtest:edge` |
| 容器平台 | `linux/amd64`（Intel/AMD 64 位） |

公开镜像可匿名拉取，无需 GitHub 账号或本地源代码。当前正式发布使用 Debian / PHP 8.3 / Apache。仓库保留上游 `Dockerfile.alpine`，但本发行版不构建和发布 Alpine、ARM 镜像。

## Docker 一条命令启动

```bash
docker run -d --name boke-speedtest --restart unless-stopped -p 127.0.0.1:18088:8080 ghcr.io/rumij/boke-speedtest:1.1.0
```

访问 `http://localhost:18088/`；稳定性测试为 `http://localhost:18088/stability.html`。Docker Desktop 请切换为 Linux 容器。

`127.0.0.1` 绑定只允许本机访问。需要局域网访问时，将端口映射改为 `-p 18088:8080`，然后访问 `http://服务器IP:18088/`，并放行主机防火墙对应端口。

如果之前已启动源码预览容器，它占用同一个 18088 端口。可以保留预览并改用 `-p 127.0.0.1:18090:8080` 测试镜像；确认后再自行替换原容器。

## Docker Compose

下载仓库根目录的 [compose.yaml](../compose.yaml)，在文件所在目录运行：

```bash
docker compose pull
docker compose up -d
docker compose ps
```

默认仅开放本机 `18088` 端口。局域网访问时，把文件中的端口映射改为 `"18088:8080"`。不需要挂载源代码，也无需数据库卷。

停止并移除本 Compose 服务：

```bash
docker compose down
```

## NAS、Portainer 等容器平台

新建容器时填写：

| 设置 | 值 |
| --- | --- |
| 镜像 | `ghcr.io/rumij/boke-speedtest:1.1.0` |
| 宿主机端口 | `18088` 或其他空闲端口 |
| 容器端口 | `8080/TCP` |
| 重启策略 | `unless-stopped` |
| 环境变量 | 可全部使用镜像默认值 |
| 存储挂载 | 默认不需要 |
| 特权模式 | 不需要 |

平台若支持 Stack / Compose，直接粘贴 [compose.yaml](../compose.yaml)，并按需修改绑定地址。测试客户端连接到哪个服务器，就测量客户端与该服务器之间的链路；把服务部署在本机得到的是本地链路结果。

## 默认配置

| 环境变量 | 默认值 | 含义 |
| --- | --- | --- |
| `MODE` | `standalone` | 前端与测速后端一体部署 |
| `USE_NEW_DESIGN` | `true` | 启用本定制主页 |
| `TELEMETRY` | `false` | 不保存测速遥测记录，无需数据库 |
| `WEBPORT` | `8080` | 容器内 Apache 监听端口 |
| `BOKE_THEME_SYNC` | `true` | 自动跟随官网视觉素材，设为 `false` 使用镜像内素材 |
| `BOKE_THEME_INTERVAL` | `300` | 检查间隔，单位秒，范围 60–86400 |

默认入口 `/` 自动跳转至现代界面。`/index-modern.html` 和 `/stability.html` 可直接访问。后端为同源 `/backend/`，静态视频及品牌图片随镜像打包。页面显示 IP/运营商信息时可能由后端查询外部 IP 信息服务。

如需多测速节点，可将节点 JSON 只读挂载到容器 `/servers.json`。参数格式与其他高级模式参考上游 [doc_docker.md](../doc_docker.md)；其中上游镜像地址要替换为本镜像。当前发布验证范围为默认 standalone 模式。

启用额外的遥测/数据库功能前需要自行配置数据库与统计页密码；默认部署不启用这些功能。公网部署建议在前面配置 HTTPS 反向代理，并确认代理允许测速上传请求及足够长的超时。

## 官网视觉自动同步（1.1.0 起）

布局、页面宽度、双轮盘、测速功能和稳定性页面的分栏保持原样。自动同步范围为：首页背景视频及封面、左上角 Logo、浏览器图标、按钮及装饰主题色。稳定性页沿用静态封面，不增加背景视频。

- 在页面可见且没有运行测试时，默认每 300 秒向本机服务检查一次。打开页面也会检查；无人访问时不轮询。官网 CDN 缓存可能造成额外延迟，这不是官网推送的即时通知。
- 服务端只读取 `https://www.boke.com/` 及白名单官方 CDN 的页面、样式数据和媒体响应头；不运行官网脚本、不导入官网布局。素材内容由浏览器从官方 CDN 加载，需要允许访问 `www.boke.com`、`css.pookcdn.net`、`png.pookcdn.net` 的 HTTPS。
- 根据素材 URL、ETag、Last-Modified 和长度识别变化，同一链接内容更新也能识别。若 CDN 不更新这些信息，则无法立即感知其内容替换。
- 检查结果缓存在容器临时目录 `/tmp/boke-theme-v1`，有锁防止重复检查。官网异常保留最后一次可用配置；新容器或图片加载失败时使用随镜像打包的素材。无需挂载数据卷；重建容器后重新检查。
- 测速开始会取消本页面待完成的主题/图片请求，并移除视频源；测试中及标签页隐藏时停止轮询。已发往服务端的小型同步请求最多 10 秒结束，其他访问者的请求也可能继续，不能替代专用测速环境的带宽隔离。
- 品牌色过浅时自动加深，以保持按钮文字可读；成功、失败和上传等含义明确的颜色不随品牌变化。
- 只识别当前官网的素材结构和主题色选择器。官网若全面改版、更换 CDN、改为脚本生成素材或改变动画实现，会保留原素材，需更新适配代码；不会自动复制任意新动画逻辑。

查看同步状态：

```bash
curl -fsS http://127.0.0.1:80/frontend/theme.php
```

按实际端口修改上面的 `80`。`status` 为 `synced` 表示最近检查成功，`cached` 表示保留上次配置，`fallback` 表示使用内置素材；`enabled: false` 表示管理员关闭同步。该接口仅返回素材配置，不接受自定义抓取地址。

已部署 `1.0.0` 的用户需要先升级镜像至 `1.1.0` 并重建容器，之后素材更新无需重复打包。保留现有端口和其他 Compose 设置，只修改 `image`。请访问 `/index-modern.html`；`/index-classic.html` 是上游经典界面，不参与同步。

## 更新与回退

建议固定镜像版本。更新时修改 Compose 的 `image` 标签，再执行：

```bash
docker compose pull
docker compose up -d
```

回退时把标签改回已知版本并执行同样命令。`latest` 会随版本发布移动，适合希望手动拉取最新版本的部署；`edge` 用于开发验证。

查询本地拉取的镜像摘要：

```bash
docker image inspect ghcr.io/rumij/boke-speedtest:1.1.0 --format '{{json .RepoDigests}}'
```

也可以把 `image` 改为 `ghcr.io/rumij/boke-speedtest@sha256:实际摘要` 来锁定构建产物。

## 检查与排障

```bash
docker logs boke-speedtest
docker inspect boke-speedtest --format '{{.State.Health.Status}}'
```

- 健康状态从 `starting` 变为 `healthy` 后访问网页。Compose 部署可使用 `docker compose logs speedtest`。
- 端口占用：换用空闲宿主机端口；容器内保持 `8080`。
- 镜像拉取超时：确认主机可访问 `ghcr.io` 及 GitHub 的镜像下载域名。
- ARM 主机提示 `no matching manifest`：当前仅发布 amd64，需使用兼容主机。
- 页面测速报错：检查浏览器能访问同源 `/backend/empty.php`，以及代理上传大小/超时限制。
- CSS 或图标缓存：强制刷新页面；升级后确保容器已重新创建。

## 自行构建与验证

```bash
git clone https://github.com/rumij/boke-speedtest.git
cd boke-speedtest
docker build -t boke-speedtest:local .
docker run -d --name boke-speedtest-check -p 127.0.0.1:18090:8080 boke-speedtest:local
npm ci
npx playwright install chromium
npm run test:release
npm run test:theme
docker rm -f boke-speedtest-check
```

发布工作流在推送 GHCR 前运行同一套本地容器检查；不需要配置额外模型或镜像仓库密钥，使用仓库自带的 `GITHUB_TOKEN`。实现遵循 [GitHub 发布容器镜像说明](https://docs.github.com/en/actions/tutorials/publish-packages/publish-docker-images)。首次包公开设置见 [GitHub 包可见性说明](https://docs.github.com/en/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility)。
