use schemars::JsonSchema;
use serde::Serialize;

pub(crate) const fn without_trailing_newline(text: &str) -> &str {
    let bytes = text.as_bytes();
    if let Some((b'\n', _)) = bytes.split_last() {
        text.split_at(text.len() - 1).0
    } else {
        text
    }
}

pub(crate) const REPLY_CONTRACT: &str =
    without_trailing_newline(include_str!("prompts/server_report.txt"));

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Card<T> {
    pub display_block: String,
    pub reply_contract: &'static str,
    #[serde(flatten)]
    pub body: T,
}

impl<T> Card<T> {
    pub(crate) fn new(display_block: impl Into<String>, body: T) -> Self {
        Self {
            display_block: display_block.into(),
            reply_contract: REPLY_CONTRACT,
            body,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Serialize, JsonSchema)]
    struct Body {
        ok: bool,
    }

    #[test]
    fn card_carries_the_reply_contract() {
        let value = serde_json::to_value(Card::new("card", Body { ok: true })).unwrap();
        assert_eq!(value["displayBlock"], "card");
        assert_eq!(value["ok"], true);
        assert_eq!(value["replyContract"], REPLY_CONTRACT);
    }
}
