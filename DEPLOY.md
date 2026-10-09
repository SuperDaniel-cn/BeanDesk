# 部署：只在本机监听，用 Cloudflare Tunnel 开门

Fava 的 `/<slug>/api/query` 可以执行任意 BQL，`/<slug>/document/` 会返回凭证文件，`ledger_data` 的 `options.filename` 会带出服务器上的账本路径。本仓库不提供登录。访问控制由 Cloudflare Access 或私有网络（如 Tailscale）承担。

下面是 Cloudflare Tunnel 的操作顺序。Tailscale 是另一种可接受的做法：VPS 和你的电脑、手机进同一个 tailnet，只通过 tailnet 地址访问下面这个本机端口，不要把该端口写进云厂商的入站规则。

## 1. Fava 只听本机

在账本目录启动，绑定回环地址：

```bash
fava --host 127.0.0.1 --port 5000 main.bean
```

确认本机可以打开 `http://127.0.0.1:5000/`，并且安全组、防火墙都没有放行 5000。

## 2. 静态站和反代也只听本机

在 `web/` 里构建：

```bash
cd web
bun install
bun run build
```

用 Caddy 把构建结果和 Fava 收成同一个本机源。浏览器请求 `/api/fava/...`，Caddy 去掉这个前缀后转给 Fava，和开发时的 Vite 代理一致。

`/etc/caddy/Caddyfile`：

```caddyfile
http://127.0.0.1:5188 {
	handle_path /api/fava/* {
		reverse_proxy 127.0.0.1:5000
	}
	handle {
		root * /var/www/BeanDesk
		try_files {path} /index.html
		file_server
	}
}
```

`try_files` 把 `/journal` 这类前端路由回退到 `index.html`。刷新报表页时仍由这套页面接管，而不是落到文件 404。`/api/fava` 先被上面的 `handle_path` 剥掉前缀，再转到 Fava。

把 `web/dist/` 放到 `/var/www/BeanDesk`。Caddy 同样只绑定 `127.0.0.1:5188`，不要写 `0.0.0.0`。

账套 slug 不是 `beancount` 时，改部署目录里的 `config.js`（构建时从 `web/public/config.js` 复制而来）：

```js
window.__APP_CONFIG__ = {
  apiBaseUrl: '',
  slug: 'your-ledger-slug',
}
```

`apiBaseUrl` 留空表示和页面同源。探测失败时页面会报错，不会悄悄继续用错误的 slug。

## 3. Cloudflare Tunnel 与 Access

1. 在 Cloudflare Zero Trust 里创建 Tunnel，在 VPS 上安装 `cloudflared` 并跑官方给出的 `service install` 命令。该进程只需要出站连接。
2. Public Hostname 指到 `http://127.0.0.1:5188`。不要另外做一条绕过隧道、直接指向源站 IP 的 DNS 记录。
3. 给这个 hostname 加 Access 应用，策略用邮箱一次性验证码（One-Time PIN）。
4. 云厂商入站规则保持关闭 5000 和 5188。SSH 若要保留，只用密钥，不要和账本端口放在一起。

通过 Access 的人仍然可以使用页面上的 BQL 查询台。隧道解决的是“谁能连上”，不是查询权限。

## 4. 上线前核对

- 从公网 IP 直接访问 `http://<vps>:5000` 和 `:5188` 都应该失败。
- 未登录 Access 时，隧道域名打不开账本。
- 登录后再打开资产负债表和试算平衡表，确认数字来自这本账。

## 5. 桌面端连远程 Fava

桌面窗口不经过 5188。它用设置里的 Fava 根地址直接请求。

Fava 仍然只听 `127.0.0.1`。要让另一台电脑上的 BeanDesk 连上，把两边放进同一个 Tailscale 或 WireGuard 网络，仅连接里填 `http://<tailnet 地址>:5000`。加密由这条虚拟网完成。云厂商的入站规则不要放行 5000。

第 3 节的 Cloudflare Tunnel 与 Access 保护的是浏览器里的 BeanDesk 站点。Access 的验证码要在浏览器里完成。桌面端的网络插件打不开那一页，所以不要把 Access 域名填进仅连接。
