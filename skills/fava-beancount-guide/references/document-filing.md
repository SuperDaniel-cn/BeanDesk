# 凭证归档与穿透关联指南

在 main.bean 中声明 option "documents" "documents" 后，由 Fava 引擎自动扫描 documents/ 目录获取凭证文件列表；BeanDesk 读取该列表后，在日记账与分录明细弹窗中建立穿透预览关联。

## 目录映射规则

1. 科目路径映射为文件夹：将科目名称中的冒号“:”转换为目录分隔符“/”。
2. 连字符目录保持整体：包含连字符的段落（如 Bank-银行存款）作为单一文件夹，切勿拆分为两层子目录。
3. 文件命名规范：采用 YYYY-MM-DD.<业务说明>.<扩展名> 格式（点号分隔），日期与对应交易分录的日期严格一致。
4. 穿透关联条件：当凭证文件日期与分录日期一致，且凭证位于交易任一科目的归档目录下（或文件名包含该笔交易的 link 标记），BeanDesk 会在日记账与分录明细弹窗中自动建立单据预览关联。

## 常见归档路径对照

| 会计科目 | 对应凭证归档目录 | 凭证文件示范 |
| :--- | :--- | :--- |
| Assets:Bank-银行存款:Main-基本户 | documents/Assets/Bank-银行存款/Main-基本户/ | 2026-03-15.银行回单.pdf |
| Expenses:Operations-管理费用:Rent-办公场地租金 | documents/Expenses/Operations-管理费用/Rent-办公场地租金/ | 2026-03-01.租金发票.pdf |
| Income:Service-主营业务收入:Consulting-架构咨询服务 | documents/Income/Service-主营业务收入/Consulting-架构咨询服务/ | 2026-03-10.服务费专票.pdf |

