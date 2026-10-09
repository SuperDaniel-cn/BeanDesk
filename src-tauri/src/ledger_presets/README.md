# Ledger language packs

`locales.toml` is the MCP `init_ledger` locale table. The `id` is the required argument and the folder name.

## Merge a reserved pack

1. Copy `en/` or `zh-CN/` to `ledger_presets/<id>/`.
2. Fill `accounts.bean`, `commodities.bean`, and `policies/`.
3. Set `status = "ready"` on that row in `locales.toml`.
4. Wire `include_str!` and a match arm in `ledger_preset.rs`.
5. Run `make test`.

Desktop Initialize Ledger always writes `zh-CN`. MCP never guesses from the OS language.

# 账本语言包

`locales.toml` 是 MCP `init_ledger` 的 locale 参数表。`id` 既是必填参数，也是目录名。

## 合并一套预留包

1. 把 `en/` 或 `zh-CN/` 复制为 `ledger_presets/<id>/`。
2. 填写 `accounts.bean`、`commodities.bean` 与 `policies/`。
3. 在 `locales.toml` 将该行 `status` 改为 `"ready"`。
4. 在 `ledger_preset.rs` 增加 `include_str!` 与 match 分支。
5. 执行 `make test`。

桌面端“初始化账本”固定写入 `zh-CN`。MCP 不根据操作系统语言猜测。
