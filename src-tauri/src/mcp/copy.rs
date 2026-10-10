use std::path::Path;

use crate::ledger_init::read_marker_locale;
use crate::policy_integrity::{Integrity, PolicyStatus};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum CardLang {
    En,
    ZhCn,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum QueryCardKind {
    Bql,
    Journal,
}

impl CardLang {
    pub(crate) fn from_tag(tag: &str) -> Self {
        if tag.trim() == "zh-CN" {
            Self::ZhCn
        } else {
            Self::En
        }
    }

    pub(crate) fn from_workdir(directory: Option<&Path>) -> Self {
        match directory.and_then(read_marker_locale) {
            Some(id) => Self::from_tag(&id),
            None => Self::En,
        }
    }
}

fn join(parts: impl IntoIterator<Item = impl AsRef<str>>) -> String {
    parts
        .into_iter()
        .map(|part| part.as_ref().trim().to_string())
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

fn pack_phrase(lang: CardLang) -> &'static str {
    match lang {
        CardLang::En => "International / US Standards (USD)",
        CardLang::ZhCn => "中国大陆会计准则 (CNY)",
    }
}

pub(crate) fn connection_display(
    lang: CardLang,
    has_local_directory: bool,
    skeleton: &str,
    has_policies_dir: bool,
    active: &str,
    origin_kind: &str,
    launch: &str,
) -> String {
    join([
        folder_sentence(lang, has_local_directory),
        skeleton_sentence(lang, skeleton, has_local_directory),
        policies_sentence(lang, has_policies_dir),
        active_sentence(lang, active),
        origin_sentence(lang, origin_kind),
        launch_sentence(lang, launch),
    ])
}

fn folder_sentence(lang: CardLang, has_local_directory: bool) -> &'static str {
    match (lang, has_local_directory) {
        (CardLang::En, true) => "Settings has a local folder.",
        (CardLang::En, false) => "Settings has no local folder.",
        (CardLang::ZhCn, true) => "已配置本机目录。",
        (CardLang::ZhCn, false) => "未配置本机目录。",
    }
}

fn skeleton_sentence(lang: CardLang, skeleton: &str, has_local_directory: bool) -> &'static str {
    match (lang, skeleton) {
        (CardLang::En, "outdated") => "The ledger skeleton is outdated.",
        (CardLang::En, "foreign") => "This folder already had a ledger.",
        (CardLang::En, "current") => "This is a BeanDesk-created ledger.",
        (CardLang::En, _) if has_local_directory => "main.bean is missing.",
        (CardLang::ZhCn, "outdated") => "账套缺少基线文件，可以升级账套结构。",
        (CardLang::ZhCn, "foreign") => "已有 Beancount 账本，尚未接管为标准账套。",
        (CardLang::ZhCn, "current") => "这是标准企业账套。",
        (CardLang::ZhCn, _) if has_local_directory => "缺少 main.bean 主账本文件。",
        _ => "",
    }
}

fn policies_sentence(lang: CardLang, has_policies_dir: bool) -> &'static str {
    if !has_policies_dir {
        return "";
    }
    match lang {
        CardLang::En => "A policies folder is present.",
        CardLang::ZhCn => "含 policies 财税合规制度。",
    }
}

fn active_sentence(lang: CardLang, active: &str) -> &'static str {
    match (lang, active) {
        (CardLang::En, "local") => "Using the local folder.",
        (CardLang::En, "remote") => "Connecting to a saved address only.",
        (CardLang::En, _) => "No active connection mode.",
        (CardLang::ZhCn, "local") => "当前模式：连接本机账本。",
        (CardLang::ZhCn, "remote") => "当前模式：仅连接远程地址。",
        (CardLang::ZhCn, _) => "未选择运行模式。",
    }
}

fn origin_sentence(lang: CardLang, origin_kind: &str) -> &'static str {
    match (lang, origin_kind) {
        (CardLang::En, "loopback") => "Fava address is loopback.",
        (CardLang::En, "remote") => "Fava address is remote.",
        (CardLang::En, _) => "Fava address is not set.",
        (CardLang::ZhCn, "loopback") => "Fava 服务地址为本机回环。",
        (CardLang::ZhCn, "remote") => "Fava 服务地址为远程服务。",
        (CardLang::ZhCn, _) => "未配置 Fava 服务地址。",
    }
}

fn launch_sentence(lang: CardLang, launch: &str) -> &'static str {
    match (lang, launch) {
        (CardLang::En, "engine") => "Launch is the bundled engine.",
        (CardLang::En, "shell") => "Launch is a custom command.",
        (CardLang::En, _) => "Launch is not configured.",
        (CardLang::ZhCn, "engine") => "服务由内置引擎驱动。",
        (CardLang::ZhCn, "shell") => "服务由自定义命令启动。",
        (CardLang::ZhCn, _) => "未配置启动方式。",
    }
}

pub(crate) fn init_pending(lang: CardLang) -> String {
    match lang {
        CardLang::En => format!(
            "Not written. Call again with confirmWrite true after the user agrees to create the first ledger in the Settings folder. Accounting standard: {}.",
            pack_phrase(lang)
        ),
        CardLang::ZhCn => format!(
            "尚未写入。请在用户确认在当前工作目录创建第一本账后，再以 confirmWrite true 发起。适用准则：{}。",
            pack_phrase(lang)
        ),
    }
}

pub(crate) fn init_written(lang: CardLang) -> String {
    match lang {
        CardLang::En => format!(
            "Created the first ledger skeleton in the Settings folder. Accounting standard: {}.",
            pack_phrase(lang)
        ),
        CardLang::ZhCn => format!(
            "已在当前工作目录创建标准账套。适用准则：{}。",
            pack_phrase(lang)
        ),
    }
}

pub(crate) fn upgrade_pending(lang: CardLang, skeleton: &str, locale: &str) -> String {
    let intent = match (lang, skeleton) {
        (CardLang::En, "foreign") => "adopt the existing Beancount folder",
        (CardLang::En, "outdated") => "upgrade the ledger skeleton",
        (CardLang::En, "current") => "upgrade (already current)",
        (CardLang::En, other) => other,
        (CardLang::ZhCn, "foreign") => "接管现有 Beancount 账本为标准账套",
        (CardLang::ZhCn, "outdated") => "升级账套结构",
        (CardLang::ZhCn, "current") => "检查更新（账套已是当前版本）",
        (CardLang::ZhCn, other) => other,
    };
    match lang {
        CardLang::En => format!(
            "Not written. Call again with confirmWrite true after the user agrees to {intent} in the Settings folder. locale={locale}. Does not change data/ entries."
        ),
        CardLang::ZhCn => format!(
            "尚未写入。请在用户确认{intent}后，再以 confirmWrite true 发起。会计准则：{locale}。不会修改现有 data/ 记账分录。"
        ),
    }
}

pub(crate) fn upgrade_written(
    lang: CardLang,
    files_empty: bool,
    adopted: bool,
    git_failed: bool,
) -> String {
    let mut display = match (lang, files_empty, adopted) {
        (CardLang::En, true, _) => "Ledger skeleton is already current.".to_string(),
        (CardLang::En, false, true) => {
            "Adopted the Settings folder as a BeanDesk ledger. Missing baseline files were added. data/ entries were not changed.".into()
        }
        (CardLang::En, false, false) => {
            "Upgraded the Settings folder ledger skeleton. Missing baseline files were added. data/ entries were not changed.".into()
        }
        (CardLang::ZhCn, true, _) => "账套已是当前版本，无需升级。".into(),
        (CardLang::ZhCn, false, true) => {
            "已成功接管为 BeanDesk 标准账套。已补齐缺失的基线文件，未改动现有记账分录。".into()
        }
        (CardLang::ZhCn, false, false) => {
            "已成功升级账套结构。已补齐缺失的基线文件，未改动现有记账分录。".into()
        }
    };
    if git_failed {
        display.push(' ');
        display.push_str(match lang {
            CardLang::En => "A Git snapshot could not be written.",
            CardLang::ZhCn => "未能自动记录 Git 快照。",
        });
    }
    display
}

pub(crate) fn bean_check_failed(lang: CardLang, code: i32) -> String {
    match lang {
        CardLang::En => format!("bean-check failed (exit {code})."),
        CardLang::ZhCn => format!("bean-check 检查未通过（语法或平衡错误，退出码 {code}）。"),
    }
}

pub(crate) fn bean_check_passed(lang: CardLang) -> String {
    match lang {
        CardLang::En => "bean-check passed.".into(),
        CardLang::ZhCn => "bean-check 已通过。".into(),
    }
}

pub(crate) fn policy_load_failed(lang: CardLang, preview: &str, sentence: &str) -> String {
    let mut display = format!(
        "{} {}",
        bean_check_passed(lang),
        match lang {
            CardLang::En => "Policy rules could not be loaded.",
            CardLang::ZhCn => "未能加载财税合规规则。",
        }
    );
    if !preview.is_empty() {
        display.push('\n');
        display.push_str(preview);
    }
    if !sentence.is_empty() {
        display.push('\n');
        display.push_str(sentence);
    }
    display
}

pub(crate) fn check_with_violations(
    lang: CardLang,
    errors: bool,
    body: &str,
    sentence: &str,
) -> String {
    let label = match (lang, errors) {
        (CardLang::En, true) => "Policy errors",
        (CardLang::En, false) => "Policy warnings",
        (CardLang::ZhCn, true) => "发现财税合规错误",
        (CardLang::ZhCn, false) => "财税合规提示警告",
    };
    let mut display = format!("{} {label}:\n{body}", bean_check_passed(lang));
    if !sentence.is_empty() {
        display.push(' ');
        display.push_str(sentence);
    }
    display
}

pub(crate) fn check_passed_with_integrity(lang: CardLang, sentence: &str) -> String {
    join([bean_check_passed(lang), sentence.to_string()])
}

pub(crate) fn integrity_sentence(lang: CardLang, status: &PolicyStatus) -> String {
    if status.review_reason.as_deref() == Some("restore")
        && status.integrity == Integrity::Unapproved
    {
        return match lang {
            CardLang::En => {
                "The ledger was restored. Review and approve or revert policies in BeanDesk.".into()
            }
            CardLang::ZhCn => {
                "当前账套刚从备份恢复。请在 BeanDesk 桌面端复核财税策略，并批准或撤销修改。"
                    .into()
            }
        };
    }
    match (lang, status.integrity) {
        (_, Integrity::Ok) => String::new(),
        (CardLang::En, Integrity::Unseeded) => {
            "Policy integrity is not seeded on this computer. Open BeanDesk to confirm the accounting standard, or call upgrade_ledger with confirmWrite. Custom TOML is not applied until approved in BeanDesk.".into()
        }
        (CardLang::ZhCn, Integrity::Unseeded) => {
            "当前账套尚未在本机注册。请在 BeanDesk 桌面端确认会计准则，或在用户同意后以 confirmWrite true 调用 upgrade_ledger。自定义规则在桌面端批准前不会生效。".into()
        }
        (CardLang::En, Integrity::Unapproved) => {
            "Custom policy files on disk differ from the last approved copies. Those disk files were not applied. Approve or revert them in BeanDesk.".into()
        }
        (CardLang::ZhCn, Integrity::Unapproved) => {
            "本地自定义规则与上次批准的版本不一致，暂未生效。请在 BeanDesk 桌面端复核并批准或撤销修改。".into()
        }
        (CardLang::En, Integrity::LocaleMismatch) => {
            "The .beandesk locale does not match the locale stored in BeanDesk. Built-in rules still follow the BeanDesk locale. Switch the accounting standard in Settings, or revert policies.".into()
        }
        (CardLang::ZhCn, Integrity::LocaleMismatch) => {
            "账套声明的会计准则与本机软件登记不一致，内置规则仍按软件登记执行。请在设置中重新确认会计准则，或撤销自定义修改。".into()
        }
        (CardLang::En, Integrity::StoreCorrupt) => {
            "Approved policy copies in BeanDesk could not be parsed. Built-in baseline rules still ran. Custom disk files were not used.".into()
        }
        (CardLang::ZhCn, Integrity::StoreCorrupt) => {
            "本机已批准的财税策略损坏无法读取。当前仅执行内置基准规则，未采用本地自定义规则。".into()
        }
    }
}

pub(crate) fn fava_answering(
    lang: CardLang,
    title: &str,
    account_count: usize,
    error_count: usize,
) -> String {
    match lang {
        CardLang::En => format!(
            "Fava is answering. Title is {title}. {account_count} accounts. {error_count} loader errors."
        ),
        CardLang::ZhCn => format!(
            "账本服务正常响应。账套：“{title}”，已开立科目：{account_count} 个，数据加载异常：{error_count} 项。"
        ),
    }
}

pub(crate) fn ledger_summary(
    lang: CardLang,
    title: &str,
    currency: &str,
    account_count: usize,
    error_count: usize,
) -> String {
    match lang {
        CardLang::En => {
            format!(
                "{title} uses {currency}. {account_count} accounts. {error_count} loader errors."
            )
        }
        CardLang::ZhCn => {
            format!(
                "账套“{title}”记账本位币为 {currency}，已开立科目：{account_count} 个，数据加载异常：{error_count} 项。"
            )
        }
    }
}

pub(crate) fn query_display(
    lang: CardLang,
    kind: QueryCardKind,
    row_count: usize,
    truncated: bool,
    preview: &str,
) -> String {
    if row_count == 0 {
        return match (lang, kind) {
            (CardLang::En, QueryCardKind::Bql) => "BQL returned no rows.".into(),
            (CardLang::En, QueryCardKind::Journal) => "Journal query returned no rows.".into(),
            (CardLang::ZhCn, QueryCardKind::Bql) => "查询未返回任何记录。".into(),
            (CardLang::ZhCn, QueryCardKind::Journal) => "日记账查询未返回任何明细。".into(),
        };
    }
    let truncated = if truncated {
        match lang {
            CardLang::En => " (truncated)",
            CardLang::ZhCn => "（已截断）",
        }
    } else {
        ""
    };
    let head = match (lang, kind) {
        (CardLang::En, QueryCardKind::Bql) => {
            format!("BQL returned {row_count} rows{truncated}.")
        }
        (CardLang::En, QueryCardKind::Journal) => {
            format!("Journal query returned {row_count} rows{truncated}.")
        }
        (CardLang::ZhCn, QueryCardKind::Bql) => {
            format!("账本查询返回 {row_count} 条记录{truncated}。")
        }
        (CardLang::ZhCn, QueryCardKind::Journal) => {
            format!("日记账查询返回 {row_count} 条分录明细{truncated}。")
        }
    };
    join([head, preview.to_string()])
}

pub(crate) fn report_display(
    lang: CardLang,
    endpoint: &str,
    time: Option<&str>,
    roots: &[String],
) -> String {
    let name = match (lang, endpoint) {
        (CardLang::En, "trial_balance") => "Trial balance",
        (CardLang::En, "balance_sheet") => "Balance sheet",
        (CardLang::En, "income_statement") => "Income statement",
        (CardLang::En, other) => other,
        (CardLang::ZhCn, "trial_balance") => "试算平衡表",
        (CardLang::ZhCn, "balance_sheet") => "资产负债表",
        (CardLang::ZhCn, "income_statement") => "利润表",
        (CardLang::ZhCn, other) => other,
    };
    let period = time.unwrap_or(match lang {
        CardLang::En => "all time",
        CardLang::ZhCn => "全部期间",
    });
    let roots = if roots.is_empty() {
        match lang {
            CardLang::En => "none".to_string(),
            CardLang::ZhCn => "无".into(),
        }
    } else {
        roots.join(", ")
    };
    match lang {
        CardLang::En => format!("{name} for {period}. Roots: {roots}."),
        CardLang::ZhCn => format!("{name}（{period}）。一级科目：{roots}。"),
    }
}

pub(crate) fn documents_display(lang: CardLang, count: usize) -> String {
    match lang {
        CardLang::En => format!("{count} documents in the Fava catalogue."),
        CardLang::ZhCn => format!("已归档并索引原始凭证 {count} 份。"),
    }
}

pub(crate) fn policies_list_display(lang: CardLang, count: usize) -> String {
    match (lang, count) {
        (CardLang::En, 0) => "No policy Markdown files in the Settings folder.".into(),
        (CardLang::En, n) => format!("{n} policy Markdown files in the Settings folder."),
        (CardLang::ZhCn, 0) => "当前账套尚未添加内控制度文档。".into(),
        (CardLang::ZhCn, n) => format!("当前账套已配置 {n} 份财税与内控制度文档。"),
    }
}

pub(crate) fn display_error(lang: CardLang, message: &str) -> String {
    if lang != CardLang::ZhCn {
        return message.to_string();
    }
    match message {
        "No connection saved in Settings." => "尚未在 BeanDesk 中配置账本连接。".into(),
        "No Fava origin in Settings." => "尚未配置账本服务地址。".into(),
        "Settings origin is not answering" => "账本服务未响应，请检查后台进程是否正常运行。".into(),
        other => other.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_zh_cn_tag_selects_chinese() {
        assert_eq!(CardLang::from_tag("zh-CN"), CardLang::ZhCn);
        assert_eq!(CardLang::from_tag("en"), CardLang::En);
        assert_eq!(CardLang::from_tag("JP"), CardLang::En);
        assert_eq!(CardLang::from_tag(""), CardLang::En);
        assert_eq!(CardLang::from_workdir(None), CardLang::En);
    }
}
