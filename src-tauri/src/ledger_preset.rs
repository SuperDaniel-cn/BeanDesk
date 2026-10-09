pub struct LedgerPreset {
    pub operating_currency: &'static str,
    pub commodities: &'static str,
    pub accounts: &'static str,
    pub policies_readme: &'static str,
    pub chart_of_accounts: &'static str,
    pub document_filing: &'static str,
    pub bookkeeping_guide: &'static str,
    pub rules: Option<&'static str>,
}

const ZH_CN: LedgerPreset = LedgerPreset {
    operating_currency: "CNY",
    commodities: include_str!("ledger_presets/zh-CN/commodities.bean"),
    accounts: include_str!("ledger_presets/zh-CN/accounts.bean"),
    policies_readme: include_str!("ledger_presets/zh-CN/policies/README.md"),
    chart_of_accounts: include_str!("ledger_presets/zh-CN/policies/base/chart-of-accounts.md"),
    document_filing: include_str!("ledger_presets/zh-CN/policies/base/document-filing.md"),
    bookkeeping_guide: include_str!("ledger_presets/zh-CN/policies/base/bookkeeping-guide.md"),
    rules: Some(include_str!(
        "ledger_presets/zh-CN/policies/base/rules.toml"
    )),
};

const EN: LedgerPreset = LedgerPreset {
    operating_currency: "USD",
    commodities: include_str!("ledger_presets/en/commodities.bean"),
    accounts: include_str!("ledger_presets/en/accounts.bean"),
    policies_readme: include_str!("ledger_presets/en/policies/README.md"),
    chart_of_accounts: include_str!("ledger_presets/en/policies/base/chart-of-accounts.md"),
    document_filing: include_str!("ledger_presets/en/policies/base/document-filing.md"),
    bookkeeping_guide: include_str!("ledger_presets/en/policies/base/bookkeeping-guide.md"),
    rules: None,
};

pub fn resolve_locale(locale: &str) -> Result<&'static str, String> {
    let trimmed = locale.trim();
    if trimmed.is_empty() {
        return Ok("zh-CN");
    }
    match trimmed {
        "zh-CN" | "zh" | "zh-Hans" | "zh_CN" | "zh-hans" => Ok("zh-CN"),
        "en" | "en-US" | "en_US" | "en-us" => Ok("en"),
        _ => Err("unsupported-locale".to_string()),
    }
}

pub fn preset(locale: &str) -> Result<&'static LedgerPreset, String> {
    match resolve_locale(locale)? {
        "en" => Ok(&EN),
        "zh-CN" => Ok(&ZH_CN),
        _ => Err("unsupported-locale".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_and_chinese_aliases_resolve_to_zh_cn() {
        assert_eq!(resolve_locale("").unwrap(), "zh-CN");
        assert_eq!(resolve_locale(" zh ").unwrap(), "zh-CN");
        assert_eq!(resolve_locale("zh-Hans").unwrap(), "zh-CN");
        assert_eq!(preset("").unwrap().operating_currency, "CNY");
    }

    #[test]
    fn english_aliases_resolve_to_en() {
        assert_eq!(resolve_locale("en").unwrap(), "en");
        assert_eq!(resolve_locale("en-US").unwrap(), "en");
        assert_eq!(preset("en").unwrap().operating_currency, "USD");
    }

    #[test]
    fn unknown_locales_are_rejected() {
        assert_eq!(resolve_locale("ar").unwrap_err(), "unsupported-locale");
        assert_eq!(resolve_locale("zh-TW").unwrap_err(), "unsupported-locale");
    }
}
