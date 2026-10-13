# 已有证书的 HTTPS 部署

适用域名：`speedtest.qpxq.net`。使用现有测速镜像，加一个 Nginx 容器接管 80/443；无需重新打包测速镜像。默认使用 1.2.0，如果服务器目前仅导入了旧版本，可先把 `compose.ssl.yaml` 中的测速镜像改成现有标签，HTTPS 配置仍然适用；网站访问质量检测需要 1.2.0 或更高版本。

## 1. 放置文件

将 `compose.ssl.yaml`、`nginx.ssl.conf` 复制到当前测速项目目录，和原来的 Compose 文件放在同一目录。在该目录执行后续命令。不要从解压后的新子目录直接启动，否则 Compose 项目名会改变，并与原容器争用端口。

```text
当前测速项目目录/
├── compose.yaml 或 docker-compose.yml  # 原配置，保留作回退
├── compose.ssl.yaml                   # 本次提供
├── nginx.ssl.conf                     # 本次提供
└── certs/
    ├── fullchain.pem                  # 站点证书 + 中间证书链
    └── privkey.key                    # 对应私钥
```

创建证书目录，把已有证书文件上传到服务器并按以上文件名保存：

```bash
mkdir -p certs
chmod 700 certs
```

使用证书平台下载的 **Nginx / PEM 格式**。证书须覆盖 `speedtest.qpxq.net`，或为 `*.qpxq.net` 通配符证书。`fullchain.pem` 中应按“站点证书在前，中间证书在后”的顺序排列；如果下载的 PEM 已包含完整证书链，可直接改名。`.pfx` / `.p12` 不可直接改名代替 PEM；私钥须为 Nginx 可直接读取的未加密 PEM。

上传完成后：

```bash
chmod 644 certs/fullchain.pem
chmod 600 certs/privkey.key
```

证书和私钥不放进镜像、不上传 GitHub。私钥只留在服务器 `certs/` 下，通过只读挂载交给 Nginx。

## 2. 切换之前先检查

域名解析须指向这台服务器，云安全组和主机防火墙放行 TCP 80、443。这里假设原测速容器占用 80，443 没有其他网关；已有 Nginx/面板占用端口时，应接入该网关，不直接启动第二个。

```bash
docker compose -f compose.ssl.yaml config -q
docker compose -f compose.ssl.yaml pull nginx
docker compose -f compose.ssl.yaml run --rm --no-deps nginx nginx -t
```

最后一条使用临时容器检查配置、证书与私钥是否匹配，不绑定宿主机端口。出现 `syntax is ok` 和 `test is successful` 后再切换。若失败，按报错修正，不继续启动。

## 3. 切换为 HTTPS

```bash
docker compose -f compose.ssl.yaml up -d
docker compose -f compose.ssl.yaml ps
```

**仅使用这一个 `-f` 文件，不要与原配置叠加。** 新配置移除了测速容器的宿主机端口映射，80/443 由 Nginx 使用。Compose 会重建测速容器，切换时会有短暂中断。

如果原项目启动时用了 `docker compose -p 某个项目名`，以上所有命令都要带上同一个 `-p`；可以从原 `docker compose ls` 中查看项目名。

访问：

- https://speedtest.qpxq.net/index-modern.html
- https://speedtest.qpxq.net/stability.html

HTTP 自动跳转 HTTPS。配置关闭了反向代理缓存、上传/下载缓冲和 gzip，并放开上传请求大小，避免这些设置影响测速。HTTPS 会增加 TLS 处理开销，实际吞吐仍受服务器 CPU 和链路影响。

检查：

```bash
curl -I https://speedtest.qpxq.net/index-modern.html
curl -I https://speedtest.qpxq.net/backend/empty.php
docker compose -f compose.ssl.yaml logs --tail 50 nginx
```

不要用 `curl -k` 作为正式证书正常的判断标准。出现证书不受信任时，核对有效期、域名和中间证书链。

## 4. 证书更新

本方案使用你已有的证书，**不自动续签**。续签后替换 `certs/` 下这两个文件，保持文件名与权限，再执行：

```bash
docker compose -f compose.ssl.yaml exec nginx nginx -t && docker compose -f compose.ssl.yaml exec nginx nginx -s reload
```

只有检查通过才会重新加载。替换完整目录挂载里的文件即可，不必重建测速镜像。

## 回退

先停止新增网关释放 80 端口，再用原配置恢复测速服务：

```bash
docker compose -f compose.ssl.yaml stop nginx
docker compose up -d speedtest
```

原来若用了 `-f` 或 `-p`，恢复时也沿用原参数。

参考：[Nginx HTTPS 与证书链](https://nginx.org/en/docs/http/configuring_https_servers.html)、[反向代理缓冲配置](https://nginx.org/en/docs/http/ngx_http_proxy_module.html)。本配置需在实际服务器上使用正式证书完成域名、信任链和公网验证。
