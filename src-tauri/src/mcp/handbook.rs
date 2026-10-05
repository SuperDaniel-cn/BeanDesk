use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::card::Card;

const PAGES: &[HandbookPage] = &[
    HandbookPage {
        slug: "index",
        en: include_str!("../../../docs/content/docs/index.mdx"),
        zh: include_str!("../../../docs/content/docs/index.zh-CN.mdx"),
    },
    HandbookPage {
        slug: "setup/first-book",
        en: include_str!("../../../docs/content/docs/setup/first-book.mdx"),
        zh: include_str!("../../../docs/content/docs/setup/first-book.zh-CN.mdx"),
    },
    HandbookPage {
        slug: "setup/existing",
        en: include_str!("../../../docs/content/docs/setup/existing.mdx"),
        zh: include_str!("../../../docs/content/docs/setup/existing.zh-CN.mdx"),
    },
    HandbookPage {
        slug: "desktop",
        en: include_str!("../../../docs/content/docs/desktop.mdx"),
        zh: include_str!("../../../docs/content/docs/desktop.zh-CN.mdx"),
    },
    HandbookPage {
        slug: "calendar",
        en: include_str!("../../../docs/content/docs/calendar.mdx"),
        zh: include_str!("../../../docs/content/docs/calendar.zh-CN.mdx"),
    },
    HandbookPage {
        slug: "mcp",
        en: include_str!("../../../docs/content/docs/mcp.mdx"),
        zh: include_str!("../../../docs/content/docs/mcp.zh-CN.mdx"),
    },
    HandbookPage {
        slug: "reports",
        en: include_str!("../../../docs/content/docs/reports.mdx"),
        zh: include_str!("../../../docs/content/docs/reports.zh-CN.mdx"),
    },
];

struct HandbookPage {
    slug: &'static str,
    en: &'static str,
    zh: &'static str,
}

#[derive(Debug, Default, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct HandbookInput {
    /// Slug such as setup/first-book, or the page title. Empty lists the catalog.
    #[serde(default)]
    pub page: String,
    /// en or zh-CN. Empty means en.
    #[serde(default)]
    pub locale: String,
}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HandbookPageRow {
    pub page: String,
    pub title: String,
    pub description: String,
}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HandbookBody {
    pub page: String,
    pub locale: String,
    pub title: String,
    pub markdown: String,
    pub pages: Vec<HandbookPageRow>,
}

struct ParsedDoc {
    title: String,
    description: String,
    markdown: String,
}

fn normalize_newlines(src: &str) -> String {
    src.replace("\r\n", "\n")
}

fn field(raw: &str, key: &str) -> String {
    let prefix = format!("{key}:");
    raw.lines()
        .find_map(|line| line.strip_prefix(&prefix).map(str::trim))
        .unwrap_or("")
        .to_string()
}

fn slug_from_href(href: &str) -> String {
    let path = href.split('#').next().unwrap_or(href);
    let stripped = path
        .strip_prefix("/zh-CN/")
        .or_else(|| path.strip_prefix("/zh-CN"))
        .unwrap_or(path);
    stripped.trim_start_matches('/').to_string()
}

fn flatten_cards(body: &str) -> String {
    let Some(start) = body.find("<Cards>") else {
        return body.trim().to_string();
    };
    let Some(end_rel) = body[start..].find("</Cards>") else {
        return body.trim().to_string();
    };
    let end = start + end_rel + "</Cards>".len();
    let inner = &body[start + "<Cards>".len()..start + end_rel];
    let mut cards = Vec::new();
    let mut rest = inner;
    while let Some(tag) = rest.find("<Card ") {
        rest = &rest[tag..];
        let Some(title) = rest
            .split("title=\"")
            .nth(1)
            .and_then(|s| s.split('"').next())
        else {
            break;
        };
        let Some(href) = rest
            .split("href=\"")
            .nth(1)
            .and_then(|s| s.split('"').next())
        else {
            break;
        };
        let Some(after) = rest.find('>') else {
            break;
        };
        let content = &rest[after + 1..];
        let Some(close) = content.find("</Card>") else {
            break;
        };
        cards.push(format!(
            "- {} — {}. {}",
            slug_from_href(href),
            title,
            content[..close].trim()
        ));
        rest = &content[close + "</Card>".len()..];
    }
    let before = body[..start].trim();
    let after = body[end..].trim();
    let mut parts = Vec::new();
    if !before.is_empty() {
        parts.push(before.to_string());
    }
    if !cards.is_empty() {
        parts.push(cards.join("\n"));
    }
    if !after.is_empty() {
        parts.push(after.to_string());
    }
    parts.join("\n\n")
}

fn parse_doc(src: &str) -> ParsedDoc {
    let text = normalize_newlines(src);
    let (title, description, body) = if let Some(rest) = text.strip_prefix("---\n") {
        if let Some((raw, body)) = rest.split_once("\n---\n") {
            (field(raw, "title"), field(raw, "description"), body)
        } else {
            (String::new(), String::new(), rest)
        }
    } else {
        (String::new(), String::new(), text.as_str())
    };
    ParsedDoc {
        title,
        description,
        markdown: flatten_cards(body),
    }
}

fn source_for(page: &HandbookPage, locale: &str) -> &'static str {
    if locale == "zh-CN" { page.zh } else { page.en }
}

fn normalize_locale(locale: &str) -> &'static str {
    match locale.trim() {
        "" | "en" | "en-US" | "en-GB" => "en",
        "zh" | "zh-CN" | "zh-Hans" | "zh_CN" => "zh-CN",
        _ => "en",
    }
}

fn catalog(locale: &str) -> Vec<HandbookPageRow> {
    PAGES
        .iter()
        .map(|page| {
            let parsed = parse_doc(source_for(page, locale));
            HandbookPageRow {
                page: page.slug.to_string(),
                title: parsed.title,
                description: parsed.description,
            }
        })
        .collect()
}

fn catalog_title(locale: &str) -> &'static str {
    if locale == "zh-CN" {
        "手册"
    } else {
        "Handbook"
    }
}

fn catalog_markdown(pages: &[HandbookPageRow], locale: &str) -> String {
    let (heading, headers) = if locale == "zh-CN" {
        ("# 手册", "| 页面 | 标题 | 说明 |")
    } else {
        ("# Handbook", "| page | title | description |")
    };
    let mut lines = vec![
        heading.to_string(),
        String::new(),
        headers.to_string(),
        "| --- | --- | --- |".to_string(),
    ];
    for page in pages {
        lines.push(format!(
            "| {} | {} | {} |",
            page.page, page.title, page.description
        ));
    }
    lines.join("\n")
}

fn resolve_page(query: &str) -> Option<&'static HandbookPage> {
    let needle = query.trim();
    if needle.is_empty() {
        return None;
    }
    PAGES
        .iter()
        .find(|page| page.slug.eq_ignore_ascii_case(needle))
        .or_else(|| {
            PAGES.iter().find(|page| {
                parse_doc(page.en).title.eq_ignore_ascii_case(needle)
                    || parse_doc(page.zh).title == needle
            })
        })
}

pub(crate) fn get_handbook_card(input: HandbookInput) -> Result<Card<HandbookBody>, String> {
    let locale = normalize_locale(&input.locale);
    if input.page.trim().is_empty() {
        let pages = catalog(locale);
        let markdown = catalog_markdown(&pages, locale);
        return Ok(Card::new(
            markdown.clone(),
            HandbookBody {
                page: String::new(),
                locale: locale.to_string(),
                title: catalog_title(locale).to_string(),
                markdown,
                pages,
            },
        ));
    }
    let Some(page) = resolve_page(&input.page) else {
        return Err("Unknown handbook page. Call get_handbook without page.".into());
    };
    let parsed = parse_doc(source_for(page, locale));
    Ok(Card::new(
        parsed.markdown.clone(),
        HandbookBody {
            page: page.slug.to_string(),
            locale: locale.to_string(),
            title: parsed.title,
            markdown: parsed.markdown,
            pages: Vec::new(),
        },
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_the_bundled_slugs() {
        let card = get_handbook_card(HandbookInput::default()).unwrap();
        let slugs: Vec<_> = card
            .body
            .pages
            .iter()
            .map(|page| page.page.as_str())
            .collect();
        assert_eq!(
            slugs,
            [
                "index",
                "setup/first-book",
                "setup/existing",
                "desktop",
                "calendar",
                "mcp",
                "reports"
            ]
        );
        assert!(card.display_block.contains("setup/first-book"));
        assert_eq!(card.body.page, "");
        assert_eq!(card.body.title, "Handbook");
        assert!(card.display_block.contains("# Handbook"));
    }

    #[test]
    fn zh_cn_catalog_uses_chinese_chrome() {
        let card = get_handbook_card(HandbookInput {
            page: String::new(),
            locale: "zh-CN".into(),
        })
        .unwrap();
        assert_eq!(card.body.page, "");
        assert_eq!(card.body.locale, "zh-CN");
        assert_eq!(card.body.title, "手册");
        assert!(card.display_block.contains("# 手册"));
        assert!(card.display_block.contains("| 页面 | 标题 | 说明 |"));
        assert!(!card.display_block.contains("# Handbook"));
        assert!(!card.display_block.contains("| page | title | description |"));
        let calendar = card
            .body
            .pages
            .iter()
            .find(|page| page.page == "calendar")
            .unwrap();
        assert_eq!(calendar.title, "日历");
    }

    #[test]
    fn reads_a_page_by_slug_or_title() {
        let by_slug = get_handbook_card(HandbookInput {
            page: "setup/first-book".into(),
            locale: String::new(),
        })
        .unwrap();
        assert!(by_slug.display_block.contains("Initialize Ledger"));
        assert!(!by_slug.display_block.contains("<Cards>"));
        assert_eq!(by_slug.body.page, "setup/first-book");

        let by_title = get_handbook_card(HandbookInput {
            page: "Local MCP".into(),
            locale: "en".into(),
        })
        .unwrap();
        assert!(by_title.display_block.contains("get_handbook"));
        assert!(!by_title.display_block.contains("get_cash_flow"));

        let zh = get_handbook_card(HandbookInput {
            page: "本机 MCP".into(),
            locale: "zh-CN".into(),
        })
        .unwrap();
        assert_eq!(zh.body.locale, "zh-CN");
        assert!(zh.display_block.contains("get_handbook"));
    }

    #[test]
    fn unknown_page_tells_the_model_to_list() {
        let err = get_handbook_card(HandbookInput {
            page: "cash-flow".into(),
            locale: String::new(),
        })
        .err()
        .unwrap();
        assert!(err.contains("Unknown handbook page"));
    }
}
