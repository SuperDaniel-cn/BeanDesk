# 上游兼容性与排错参考

## 推荐上游环境

- Python: 3.10 或更高
- beancount: `>=3.2.0`
- fava: `>=1.30.0, <2.0.0`

## 常见情况排查

### 5000 端口占用

macOS 隔空播放接收服务默认占用 5000 端口。可在系统设置中关闭隔空播放接收器，或在启动 Fava 时指定其他端口（例如 5001）：
fava --host 127.0.0.1 -p 5001 main.bean

### 账本服务连接排查

1. 确认 Fava 服务正常运行且监听在 127.0.0.1。
2. 在账本目录下执行 bean-check main.bean，确认账本语法与平衡性无报错。
3. 通过 MCP 工具 get_connection 检查 BeanDesk 当前保存的连接设置与工作目录。

### 报表界面显示英文科目

检查 config/accounts.bean 中的 open 指令：
- 若科目写为 Assets:Bank:Checking，或仅在行末添加注释 ; 银行存款，前端将按英文路径解析。
- 将 open 指令调整为连字符规范格式（如 Assets:Bank-银行存款:Main-XX银行对公户），即可自动提取中文名称展示。

### 凭证未能穿透预览

1. 确认 main.bean 中已加入 option "documents" "documents"。
2. 确认凭证文件名前缀日期与对应交易分录的日期严格一致。
3. 确认连字符文件夹完整保留（例如 documents/Assets/Bank-银行存款/，未拆分为多级嵌套）。
