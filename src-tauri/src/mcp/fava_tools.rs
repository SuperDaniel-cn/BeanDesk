use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::card::Card;
use super::fava::{FavaHttp, operating_currency, query_time, quote_commodity};
use super::tools::{
    PREVIEW_LINES, active_origin, explain_store, preview_output, resolve_connection,
};

const BODY_ROWS: usize = 50;
const JOURNAL_BQL: &str = "SELECT id, date, flag, payee, narration, account, units(position) as units, tags, links ORDER BY date DESC LIMIT 51";

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct TimeInput {
    #[serde(default)]
    pub time: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct BqlInput {
    pub query_string: String,
    #[serde(default)]
    pub time: String,
}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FavaStatusBody {
    pub answering: bool,
    pub slug: String,
    pub title: String,
    pub account_count: usize,
    pub error_count: usize,
    pub origin: String,
}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LedgerBody {
    pub title: String,
    pub currency: String,
    pub account_count: usize,
    pub error_count: usize,
    pub accounts: Vec<String>,
    pub errors: Vec<String>,
    pub slug: String,
}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct QueryBody {
    pub row_count: usize,
    pub truncated: bool,
    pub types: Vec<String>,
    pub rows: Vec<Value>,
    pub time: String,
    pub slug: String,
}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReportBody {
    pub time: String,
    pub slug: String,
    pub roots: Vec<String>,
    pub data: Value,
}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DocumentsBody {
    pub count: usize,
    pub truncated: bool,
    pub documents: Vec<DocumentRow>,
    pub slug: String,
}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DocumentRow {
    pub date: String,
    pub account: String,
    pub filename: String,
}

fn fava_from(store: Option<&Value>) -> Result<FavaHttp, String> {
    let resolved = resolve_connection(store).map_err(explain_store)?;
    Ok(FavaHttp::new(active_origin(resolved.value())?))
}

fn down_fava(message: impl Into<String>, origin: String) -> Card<FavaStatusBody> {
    Card::new(
        message.into(),
        FavaStatusBody {
            answering: false,
            slug: String::new(),
            title: String::new(),
            account_count: 0,
            error_count: 0,
            origin,
        },
    )
}

pub(crate) fn get_fava_card(store: Option<&Value>) -> Result<Card<FavaStatusBody>, String> {
    let fava = match fava_from(store) {
        Ok(fava) => fava,
        Err(error) => return Ok(down_fava(error, String::new())),
    };
    match fava.resolve_ledger() {
        Ok((slug, data)) => {
            let title = ledger_title(&data).to_string();
            let account_count = data
                .get("accounts")
                .and_then(Value::as_array)
                .map(Vec::len)
                .unwrap_or(0);
            let error_count = error_count(&data);
            Ok(Card::new(
                format!(
                    "Fava is answering. Title is {title}. {account_count} accounts. {error_count} loader errors."
                ),
                FavaStatusBody {
                    answering: true,
                    slug,
                    title,
                    account_count,
                    error_count,
                    origin: fava.origin().to_string(),
                },
            ))
        }
        Err(error) => Ok(down_fava(error, fava.origin().to_string())),
    }
}

pub(crate) fn get_ledger_card(store: Option<&Value>) -> Result<Card<LedgerBody>, String> {
    let fava = fava_from(store)?;
    let (slug, data) = fava.resolve_ledger()?;
    let accounts = data.get("accounts").and_then(Value::as_array);
    let account_count = accounts.map(Vec::len).unwrap_or(0);
    let account_names: Vec<String> = accounts
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .take(BODY_ROWS)
                .collect()
        })
        .unwrap_or_default();
    let errors = error_previews(&data);
    let title = ledger_title(&data).to_string();
    let currency = operating_currency(data.get("options")).to_string();
    let error_count = error_count(&data);
    Ok(Card::new(
        format!("{title} uses {currency}. {account_count} accounts. {error_count} loader errors."),
        LedgerBody {
            title,
            currency,
            account_count,
            error_count,
            accounts: account_names,
            errors,
            slug,
        },
    ))
}

pub(crate) fn run_bql_card(
    store: Option<&Value>,
    input: BqlInput,
) -> Result<Card<QueryBody>, String> {
    let query = input.query_string.trim();
    if query.is_empty() {
        return Err("queryString is required".into());
    }
    query_card(store, query, &input.time)
}

pub(crate) fn get_journal_card(
    store: Option<&Value>,
    input: TimeInput,
) -> Result<Card<QueryBody>, String> {
    query_card(store, JOURNAL_BQL, &input.time)
}

fn query_card(store: Option<&Value>, query: &str, time: &str) -> Result<Card<QueryBody>, String> {
    let fava = fava_from(store)?;
    let (slug, _) = fava.resolve_ledger()?;
    let time = query_time(time)?;
    let mut params = vec![("query_string", query)];
    if let Some(token) = time {
        params.push(("time", token));
    }
    let data = fava.get_data(&format!("/{slug}/api/query"), &params)?;
    let types = data
        .get("types")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.get("name").and_then(Value::as_str).map(str::to_string))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let all_rows = data.get("rows").and_then(Value::as_array);
    let row_count = all_rows.map(Vec::len).unwrap_or(0);
    let truncated = row_count > BODY_ROWS;
    let rows: Vec<Value> = all_rows
        .map(|items| items.iter().take(BODY_ROWS).cloned().collect())
        .unwrap_or_default();
    let preview = rows
        .iter()
        .take(PREVIEW_LINES)
        .map(Value::to_string)
        .collect::<Vec<_>>()
        .join("\n");
    let display = if row_count == 0 {
        "BQL returned no rows.".to_string()
    } else {
        format!(
            "BQL returned {row_count} rows{}. {}",
            if truncated { " (truncated)" } else { "" },
            preview_output(&preview)
        )
    };
    Ok(Card::new(
        display,
        QueryBody {
            row_count,
            truncated,
            types,
            rows,
            time: time.unwrap_or("").to_string(),
            slug,
        },
    ))
}

pub(crate) fn get_trial_balance_card(
    store: Option<&Value>,
    input: TimeInput,
) -> Result<Card<ReportBody>, String> {
    report_card(store, "trial_balance", &input.time)
}

pub(crate) fn get_balance_sheet_card(
    store: Option<&Value>,
    input: TimeInput,
) -> Result<Card<ReportBody>, String> {
    report_card(store, "balance_sheet", &input.time)
}

pub(crate) fn get_income_statement_card(
    store: Option<&Value>,
    input: TimeInput,
) -> Result<Card<ReportBody>, String> {
    report_card(store, "income_statement", &input.time)
}

fn report_card(
    store: Option<&Value>,
    endpoint: &str,
    time: &str,
) -> Result<Card<ReportBody>, String> {
    let fava = fava_from(store)?;
    let (slug, ledger) = fava.resolve_ledger()?;
    let currency = quote_commodity(operating_currency(ledger.get("options")))?;
    let time = query_time(time)?;
    let mut params = vec![("conversion", currency)];
    if let Some(token) = time {
        params.push(("time", token));
    }
    let data = fava.get_data(&format!("/{slug}/api/{endpoint}"), &params)?;
    let roots = tree_roots(&data);
    let display = format!(
        "{} for {}. Roots: {}.",
        endpoint.replace('_', " "),
        time.unwrap_or("all time"),
        if roots.is_empty() {
            "none".into()
        } else {
            roots.join(", ")
        }
    );
    Ok(Card::new(
        display,
        ReportBody {
            time: time.unwrap_or("").to_string(),
            slug,
            roots,
            data,
        },
    ))
}

pub(crate) fn list_documents_card(store: Option<&Value>) -> Result<Card<DocumentsBody>, String> {
    let fava = fava_from(store)?;
    let (slug, _) = fava.resolve_ledger()?;
    let data = fava.get_data(&format!("/{slug}/api/documents"), &[])?;
    let items = data
        .as_array()
        .ok_or_else(|| "Fava documents catalogue was not a list.".to_string())?;
    let count = items.len();
    let truncated = count > BODY_ROWS;
    let documents = items
        .iter()
        .take(BODY_ROWS)
        .map(|item| DocumentRow {
            date: item
                .get("date")
                .and_then(Value::as_str)
                .unwrap_or("")
                .into(),
            account: item
                .get("account")
                .and_then(Value::as_str)
                .unwrap_or("")
                .into(),
            filename: item
                .get("filename")
                .and_then(Value::as_str)
                .unwrap_or("")
                .into(),
        })
        .collect::<Vec<_>>();
    Ok(Card::new(
        format!("{count} documents in the Fava catalogue."),
        DocumentsBody {
            count,
            truncated,
            documents,
            slug,
        },
    ))
}

fn ledger_title(data: &Value) -> &str {
    data.pointer("/options/title")
        .and_then(Value::as_str)
        .unwrap_or("Ledger")
}

fn error_count(data: &Value) -> usize {
    data.get("errors")
        .and_then(Value::as_array)
        .map(Vec::len)
        .unwrap_or(0)
}

fn error_previews(data: &Value) -> Vec<String> {
    data.get("errors")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| {
            item.get("message")
                .and_then(Value::as_str)
                .filter(|message| !message.is_empty())
                .map(str::to_string)
        })
        .take(PREVIEW_LINES)
        .collect()
}

fn tree_roots(data: &Value) -> Vec<String> {
    let mut names = Vec::new();
    collect_accounts(data.get("trees"), &mut names, 12);
    names
}

fn collect_accounts(nodes: Option<&Value>, names: &mut Vec<String>, limit: usize) {
    let Some(items) = nodes.and_then(Value::as_array) else {
        return;
    };
    for node in items {
        if names.len() >= limit {
            return;
        }
        match node.get("account").and_then(Value::as_str) {
            Some(account) if !account.is_empty() => names.push(account.to_string()),
            _ => collect_accounts(node.get("children"), names, limit),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp::tools::fixture_store;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::{Arc, Mutex};
    use std::thread;

    fn store_for(origin: &str) -> Value {
        let mut store = fixture_store("/private/tmp/named-repo-must-not-appear", "local");
        store["connection"]["local"]["origin"] = Value::String(origin.into());
        store
    }

    fn start_mock(
        handler: impl Fn(&str) -> (u16, Vec<(String, String)>, String) + Send + 'static,
    ) -> (String, Arc<Mutex<Vec<String>>>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(false).unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let seen = Arc::new(Mutex::new(Vec::new()));
        let log = seen.clone();
        thread::spawn(move || {
            while let Ok((mut stream, _)) = listener.accept() {
                let mut buf = [0u8; 4096];
                let _ = stream.read(&mut buf);
                let request = String::from_utf8_lossy(&buf);
                let path = request
                    .lines()
                    .next()
                    .and_then(|line| line.split_whitespace().nth(1))
                    .unwrap_or("/")
                    .to_string();
                log.lock().unwrap().push(path.clone());
                let (status, headers, body) = handler(&path);
                let reason = match status {
                    302 => "Found",
                    404 => "Not Found",
                    _ => "OK",
                };
                let mut extra = String::new();
                for (key, value) in headers {
                    extra.push_str(&format!("{key}: {value}\r\n"));
                }
                let _ = write!(
                    stream,
                    "HTTP/1.1 {status} {reason}\r\nContent-Length: {}\r\nConnection: close\r\n{extra}\r\n{body}",
                    body.len()
                );
            }
        });
        (origin, seen)
    }

    #[test]
    fn get_fava_reports_a_down_origin() {
        let store = store_for("http://127.0.0.1:1");
        let card = get_fava_card(Some(&store)).unwrap();
        assert!(!card.body.answering);
        assert!(card.display_block.contains("not answering"));
        assert!(!card.display_block.contains("named-repo-must-not-appear"));
    }

    #[test]
    fn empty_time_is_left_off_the_query() {
        let (origin, seen) = start_mock(|path| {
            if path.ends_with("/api/ledger_data") {
                (
                    200,
                    vec![("Content-Type".into(), "application/json".into())],
                    r#"{"data":{"options":{"title":"Ledger","operating_currency":["CNY"]},"accounts":["Assets"],"errors":[]}}"#.into(),
                )
            } else if path.contains("/api/query") {
                (
                    200,
                    vec![("Content-Type".into(), "application/json".into())],
                    r#"{"data":{"types":[{"name":"account"}],"rows":[["Assets:Cash"]]}}"#.into(),
                )
            } else {
                (404, vec![], String::new())
            }
        });
        let store = store_for(&origin);
        let card = run_bql_card(
            Some(&store),
            BqlInput {
                query_string: "SELECT account".into(),
                time: String::new(),
            },
        )
        .unwrap();
        assert_eq!(card.body.row_count, 1);
        assert_eq!(card.body.time, "");
        let paths = seen.lock().unwrap().clone();
        assert!(paths.iter().any(|path| path.contains("/api/query")));
        assert!(paths.iter().all(|path| !path.contains("time=")));
        assert!(!card.display_block.contains("named-repo-must-not-appear"));
    }

    #[test]
    fn slug_follows_the_root_redirect() {
        let (origin, _) = start_mock(|path| {
            if path == "/" {
                return (
                    302,
                    vec![("Location".into(), "/books/".into())],
                    String::new(),
                );
            }
            if path.starts_with("/books/api/ledger_data") {
                return (
                    200,
                    vec![("Content-Type".into(), "application/json".into())],
                    r#"{"data":{"options":{"title":"Books","operating_currency":["CNY"]},"accounts":["Assets","Income"],"errors":[{"message":"ok","source":{"filename":"/secret/main.bean"}}]}}"#.into(),
                );
            }
            (404, vec![], String::new())
        });
        let store = store_for(&origin);
        let card = get_ledger_card(Some(&store)).unwrap();
        assert_eq!(card.body.slug, "books");
        assert_eq!(card.body.account_count, 2);
        assert_eq!(card.body.error_count, 1);
        assert!(!card.display_block.contains("/secret/main.bean"));
        assert!(!card.display_block.contains("named-repo-must-not-appear"));
    }

    #[test]
    fn get_fava_explains_a_missing_store() {
        let card = get_fava_card(Some(&serde_json::json!({}))).unwrap();
        assert!(!card.body.answering);
        assert!(card.display_block.contains("No connection saved"));
    }

    #[test]
    fn default_slug_json_error_does_not_probe_root() {
        let (origin, seen) = start_mock(|path| {
            if path.ends_with("/api/ledger_data") {
                (
                    200,
                    vec![("Content-Type".into(), "application/json".into())],
                    r#"{"error":"file missing"}"#.into(),
                )
            } else {
                (200, vec![], String::new())
            }
        });
        let err = get_ledger_card(Some(&store_for(&origin))).err().unwrap();
        assert!(err.contains("file missing"));
        assert!(seen.lock().unwrap().iter().all(|path| path != "/"));
    }

    #[test]
    fn failed_default_slug_keeps_http_status() {
        let (origin, _) = start_mock(|_| (404, vec![], String::new()));
        let card = get_fava_card(Some(&store_for(&origin))).unwrap();
        assert!(!card.body.answering);
        assert!(card.display_block.contains("404"));
    }

    #[test]
    fn html_on_default_slug_is_not_a_live_fava() {
        let (origin, _) = start_mock(|path| {
            if path.ends_with("/api/ledger_data") {
                (200, vec![], "<html>nope</html>".into())
            } else {
                (200, vec![], String::new())
            }
        });
        let card = get_fava_card(Some(&store_for(&origin))).unwrap();
        assert!(!card.body.answering);
        assert_eq!(card.body.slug, "");
    }

    #[test]
    fn ledger_counts_every_loader_error() {
        let (origin, _) = start_mock(|path| {
            if path.ends_with("/api/ledger_data") {
                (
                    200,
                    vec![("Content-Type".into(), "application/json".into())],
                    r#"{"data":{"options":{"title":"Ledger","operating_currency":["CNY"]},"accounts":[],"errors":[{},{"message":"late"}]}}"#.into(),
                )
            } else {
                (404, vec![], String::new())
            }
        });
        let card = get_ledger_card(Some(&store_for(&origin))).unwrap();
        assert_eq!(card.body.error_count, 2);
        assert_eq!(card.body.errors, ["late"]);
    }

    #[test]
    fn documents_rejects_a_non_list() {
        let (origin, _) = start_mock(|path| {
            if path.ends_with("/api/ledger_data") {
                (
                    200,
                    vec![("Content-Type".into(), "application/json".into())],
                    r#"{"data":{"options":{"title":"Ledger","operating_currency":["CNY"]},"accounts":[],"errors":[]}}"#.into(),
                )
            } else if path.ends_with("/api/documents") {
                (
                    200,
                    vec![("Content-Type".into(), "application/json".into())],
                    r#"{"data":{}}"#.into(),
                )
            } else {
                (404, vec![], String::new())
            }
        });
        let err = list_documents_card(Some(&store_for(&origin)))
            .err()
            .unwrap();
        assert!(err.contains("not a list"));
    }
}
