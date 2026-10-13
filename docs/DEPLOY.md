# 容器部署

## 发布地址

| 项目 | 地址 |
| --- | --- |
| 源码 | https://github.com/rumij/boke-speedtest |
| GitHub Container Registry | https://github.com/rumij/boke-speedtest/pkgs/container/boke-speedtest |
| 固定版本镜像 | `ghcr.io/rumij/boke-speedtest:1.0.0` |
| 最新稳定版 | `ghcr.io/rumij/boke-speedtest:latest` |
| 开发版 | `ghcr.io/rumij/boke-speedtest:edge` |
| 容器平台 | `linux/amd64`（Intel/AMD 64 位） |

公开镜像可匿名拉取，无需 GitHub 账号或本地源代码。当前正式发布使用 Debian / PHP 8.3 / Apache。仓库保留上游 `Dockerfile.alpine`，但本发行版不构建和发布 Alpine、ARM 镜像。

## Docker 一条命令启动

```bash
docker run -d --name boke-speedtest --restart unless-stopped -p 127.0.0.1:18088:8080 ghcr.io/rumij/boke-speedtest:1.0.0
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
| 镜像 | `ghcr.io/rumij/boke-speedtest:1.0.0` |
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

默认入口 `/` 自动跳转至现代界面。`/index-modern.html` 和 `/stability.html` 可直接访问。后端为同源 `/backend/`，静态视频及品牌图片随镜像打包。页面显示 IP/运营商信息时可能由后端查询外部 IP 信息服务。

如需多测速节点，可将节点 JSON 只读挂载到容器 `/servers.json`。参数格式与其他高级模式参考上游 [doc_docker.md](../doc_docker.md)；其中上游镜像地址要替换为本镜像。首版发布验证范围为默认 standalone 模式。

启用额外的遥测/数据库功能前需要自行配置数据库与统计页密码；默认部署不启用这些功能。公网部署建议在前面配置 HTTPS 反向代理，并确认代理允许测速上传请求及足够长的超时。

## 更新与回退

建议固定镜像版本。更新时修改 Compose 的 `image` 标签，再执行：

```bash
docker compose pull
docker compose up -d
```

回退时把标签改回已知版本并执行同样命令。`latest` 会随版本发布移动，适合希望手动拉取最新版本的部署；`edge` 用于开发验证。

查询本地拉取的镜像摘要：

```bash
docker image inspect ghcr.io/rumij/boke-speedtest:1.0.0 --format '{{json .RepoDigests}}'
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
- ARM 主机提示 `no matching manifest`：首版仅发布 amd64，需使用兼容主机。
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
docker rm -f boke-speedtest-check
```

发布工作流在推送 GHCR 前运行同一套本地容器检查；不需要配置额外模型或镜像仓库密钥，使用仓库自带的 `GITHUB_TOKEN`。实现遵循 [GitHub 发布容器镜像说明](https://docs.github.com/en/actions/tutorials/publish-packages/publish-docker-images)。首次包公开设置见 [GitHub 包可见性说明](https://docs.github.com/en/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility)。
