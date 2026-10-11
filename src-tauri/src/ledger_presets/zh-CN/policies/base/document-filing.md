# 凭证归档

在 `main.bean` 中声明 `option "documents" "documents"` 后，Fava 扫描 `documents/`，BeanDesk 在日记账中做穿透预览。

## 路径规则

1. 将科目路径中的冒号 `:` 换成目录分隔符 `/`。
2. 每个 `英文前缀-中文名称` 段落对应一层文件夹；连字符留在文件夹名里，不要拆成两层子目录。
3. 文件名使用 `YYYY-MM-DD.说明.扩展名`，日期与对应分录的交易日期一致。票面有法定或合同唯一编号时，应写成 `YYYY-MM-DD.inv-<完整号码>.说明.扩展名` 或 `YYYY-MM-DD.ct-<完整合同号>.说明.扩展名`；号码写全，禁止截成后几位，也禁止为无号收据、转账截图、银行回单自造编号。无编号凭据保持 `YYYY-MM-DD.说明.扩展名`。

## 示例

| 科目 | 目录 |
| --- | --- |
| Assets:Bank-银行存款:Main-基本户 | documents/Assets/Bank-银行存款/Main-基本户/ |
| Income:Service-主营业务收入:Consulting-架构咨询服务 | documents/Income/Service-主营业务收入/Consulting-架构咨询服务/ |
| Expenses:Operations-管理费用:Rent-办公场地租金 | documents/Expenses/Operations-管理费用/Rent-办公场地租金/ |

```
documents/Assets/Bank-银行存款/Main-基本户/2026-03-15.银行回单.pdf
documents/Income/Service-主营业务收入/Consulting-架构咨询服务/2026-03-15.inv-26312000000123456789.发票.pdf
```

注意：切勿将 `Bank-银行存款` 拆分为 `Bank/银行存款` 两层子目录。凭证通过“文件日期与科目归档目录匹配”或“文件名包含交易的 link 标记（分录声明的 ^link 提取后不含 ^ 前缀）”与分录建立关联；若两者均不满足，日记账中凭证图标将无法点亮建立关联。
