use std::sync::OnceLock;

use serde::Deserialize;

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

#[derive(Deserialize)]
struct LocaleFile {
    pack: Vec<LocalePack>,
}

#[derive(Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
enum PackStatus {
    Ready,
    Reserved,
}

#[derive(Deserialize)]
struct LocalePack {
    id: String,
    status: PackStatus,
}

fn catalog() -> &'static [LocalePack] {
    static TABLE: OnceLock<Vec<LocalePack>> = OnceLock::new();
    TABLE.get_or_init(|| {
        let parsed: LocaleFile = toml::from_str(include_str!("ledger_presets/locales.toml"))
            .expect("ledger_presets/locales.toml");
        parsed.pack
    })
}

pub fn preset(locale: &str) -> Result<&'static LedgerPreset, String> {
    let id = locale.trim();
    if id.is_empty() {
        return Err("missing-locale".to_string());
    }
    let Some(row) = catalog().iter().find(|row| row.id == id) else {
        return Err("unsupported-locale".to_string());
    };
    match row.status {
        PackStatus::Reserved => Err("missing-pack".to_string()),
        PackStatus::Ready => match id {
            "en" => Ok(&EN),
            "zh-CN" => Ok(&ZH_CN),
            _ => Err("unsupported-locale".to_string()),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn catalog_ids_are_unique_and_only_zh_cn_and_en_are_ready() {
        let mut seen = HashSet::new();
        let mut ready = Vec::new();
        for row in catalog() {
            assert!(
                seen.insert(row.id.as_str()),
                "duplicate locale id {}",
                row.id
            );
            if row.status == PackStatus::Ready {
                ready.push(row.id.as_str());
            }
        }
        ready.sort_unstable();
        assert_eq!(ready, ["en", "zh-CN"]);
        assert!(catalog().len() > 100);
        assert_eq!(preset("zh-CN").unwrap().operating_currency, "CNY");
        assert_eq!(preset("en").unwrap().operating_currency, "USD");
    }

    #[test]
    fn locale_must_be_an_exact_ready_id() {
        assert_eq!(preset("").err().as_deref(), Some("missing-locale"));
        assert_eq!(preset("   ").err().as_deref(), Some("missing-locale"));
        assert_eq!(preset("zh").err().as_deref(), Some("unsupported-locale"));
        assert_eq!(
            preset("zh-Hans").err().as_deref(),
            Some("unsupported-locale")
        );
        assert_eq!(preset("en-US").err().as_deref(), Some("unsupported-locale"));
        assert_eq!(preset("ar").err().as_deref(), Some("unsupported-locale"));
        assert_eq!(preset("JP").err().as_deref(), Some("missing-pack"));
    }
}
