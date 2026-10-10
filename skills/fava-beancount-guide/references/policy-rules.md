# 自动化合规规则编写指南（TOML）

工作目录 policies/ 下的 TOML 规则文件由 BeanDesk MCP check_ledger 自动执行。在语法与分录平衡校验通过后，核验生效区间内交易的业务合规性。

## 文件放置

规则放置于 policies/*.toml 或 policies/*/*.toml（支持最多两层子目录，单文件不超过 256KB）。

## 规则配置字段

- id：规则唯一标识。
- description：校验未通过时的提示文案。
- severity：严重级别，选用 "error"（报错拦截）或 "warning"（仅提示）。
- from：生效起始日期（包含当天）。
- until：失效日期（可选，不含当天，左闭右开）。
- account：目标科目完整路径，支持末尾通配符（如 Assets:Bank-银行存款:*）。

每条规则定义单一核验动作。`account_pattern` 对窗口内每一条分录科目做全串正则匹配，不要与 `account` 或其它动作同时出现。

## 六类动作示范

```toml
# 动作 1：要求交易附带特定标签
[[rules]]
id = "rd-tag-check"
description = "研发支出须附带 #rd 标签"
severity = "error"
from = "2026-01-01"
account = "Expenses:Payroll-员工薪酬:Salary-研发基本工资"
require_tag = "rd"

# 动作 2：要求往来单位 Payee 非空
[[rules]]
id = "bank-payee-required"
description = "银行对公流水必须记录往来单位"
severity = "error"
from = "2026-01-01"
account = "Assets:Bank-银行存款:*"
require_payee = true

# 动作 3：分录摘要正则匹配
[[rules]]
id = "owner-advance-narration"
description = "股东垫资还款摘要须注明还款事由"
severity = "warning"
from = "2026-01-01"
account = "Liabilities:Owner-股东往来:Advance-法人垫资借款"
narration_regex = ".*(还股东借款|还垫付款).*"

# 动作 4：金额正负符号约束（"positive" 或 "negative"）
[[rules]]
id = "operating-cost-sign"
description = "主营业务成本支出分录金额必须为正数借方"
severity = "error"
from = "2026-01-01"
account = "Expenses:Operations-主营业务成本:Cloud-云计算与算力"
posting_sign = "positive"

# 动作 5：禁用科目列表（无需 account 字段）
[[rules]]
id = "deprecated-account-guard"
description = "该科目已调整，请使用新规范科目"
severity = "error"
from = "2026-01-01"
forbidden_accounts = ["Expenses:Tax-税金及附加:Surcharges-旧城建税"]

# 动作 6：科目全串正则（无需 account 字段；语言规则写在正则里，不写在引擎里）
[[rules]]
id = "localized-account-naming"
description = "分录科目必须使用英文前缀-中文名称"
severity = "error"
from = "2020-01-01"
account_pattern = '^(Assets|Liabilities|Equity|Income|Expenses)(:[A-Z][A-Za-z0-9]*-[^\s:]*\p{Han}[^\s:]*)+$'
```
