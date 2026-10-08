# 凭证归档与穿透关联指南

在 main.bean 中声明 option "documents" "documents" 后，由 Fava 引擎自动扫描 documents/ 目录获取凭证文件列表；BeanDesk 读取该列表后，在日记账与分录明细弹窗中建立穿透预览关联。

## 目录映射规则

1. 科目路径映射为文件夹：将科目名称中的冒号 : 转换为目录分隔符 /。
2. 连字符目录保持整体：包含连字符的段落（如 Bank-银行存款）作为单一文件夹，不作二次拆分。
3. 文件命名规范：采用 YYYY-MM-DD.<说明>.<扩展名> 格式，日期与对应交易分录的日期一致。
4. 穿透关联条件：当凭证文件日期与分录日期一致，且凭证位于交易任一科目的归档目录下（或文件名包含该笔交易的 link 字符串，分录中声明的 ^link 提取后不含 ^ 前缀），BeanDesk 会在日记账与分录明细弹窗中自动建立单据预览关联。

## 常见归档路径对照

| 会计科目 | 对应凭证归档目录 |
| --- | --- |
| Assets:Bank-银行存款:Main-XX银行对公户 | documents/Assets/Bank-银行存款/Main-XX银行对公户/ |
| Expenses:Operations-主营业务成本:Cloud-云计算与算力 | documents/Expenses/Operations-主营业务成本/Cloud-云计算与算力/ |
| Income:Service-主营业务收入:Tech-软件定制开发 | documents/Income/Service-主营业务收入/Tech-软件定制开发/ |
| Assets:FixedAssets-固定资产:Computers-研发电脑 | documents/Assets/FixedAssets-固定资产/Computers-研发电脑/ |

## 归档文件示范

- 银行回单：
  documents/Assets/Bank-银行存款/Main-XX银行对公户/2026-02-10.银行回单-云服务扣款.pdf
- 采购发票：
  documents/Expenses/Operations-主营业务成本/Cloud-云计算与算力/2026-02-10.XX云算力服务发票.pdf
