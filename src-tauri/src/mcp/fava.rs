use std::time::Duration;

use serde_json::Value;
use ureq::{Agent, AgentBuilder, Error as UreqError};

const DEFAULT_SLUG: &str = "beancount";
const UNREACHABLE: &str = "Settings origin is not answering";
const TIMEOUT: Duration = Duration::from_secs(8);

pub(crate) struct FavaHttp {
    origin: String,
    api: Agent,
    probe: Agent,
}

struct HttpResponse {
    location: Option<String>,
    url: String,
}

impl FavaHttp {
    pub(crate) fn new(origin: String) -> Self {
        Self {
            origin,
            api: AgentBuilder::new().timeout(TIMEOUT).redirects(4).build(),
            probe: AgentBuilder::new().timeout(TIMEOUT).redirects(0).build(),
        }
    }

    pub(crate) fn origin(&self) -> &str {
        &self.origin
    }

    pub(crate) fn resolve_ledger(&self) -> Result<(String, Value), String> {
        match self.get_json(&format!("/{DEFAULT_SLUG}/api/ledger_data"), &[]) {
            Ok(json) => Ok((DEFAULT_SLUG.to_string(), fava_data(json)?)),
            Err(error) if error == UNREACHABLE => Err(error),
            Err(first) => {
                let root = self.probe_root()?;
                let discovered = root
                    .location
                    .as_deref()
                    .and_then(slug_from_redirect)
                    .or_else(|| slug_from_redirect(&root.url));
                let Some(slug) = discovered else {
                    return Err(first);
                };
                let data = self.get_data(&format!("/{slug}/api/ledger_data"), &[])?;
                Ok((slug, data))
            }
        }
    }

    pub(crate) fn get_data(&self, path: &str, query: &[(&str, &str)]) -> Result<Value, String> {
        fava_data(self.get_json(path, query)?)
    }

    fn get_json(&self, path: &str, query: &[(&str, &str)]) -> Result<Value, String> {
        let url = format!("{}{path}", self.origin);
        let mut request = self.api.get(&url);
        for (key, value) in query {
            request = request.query(key, value);
        }
        request
            .call()
            .map_err(explain_ureq)?
            .into_json()
            .map_err(|error| error.to_string())
    }

    fn probe_root(&self) -> Result<HttpResponse, String> {
        let url = format!("{}/", self.origin);
        match self.probe.get(&url).call() {
            Ok(response) => Ok(read_response(response)),
            Err(UreqError::Status(_, response)) => Ok(read_response(response)),
            Err(error) => Err(explain_ureq(error)),
        }
    }
}

fn json_error(json: &Value) -> Option<&str> {
    json.get("error")
        .and_then(Value::as_str)
        .filter(|error| !error.is_empty())
}

fn fava_data(json: Value) -> Result<Value, String> {
    if let Some(error) = json_error(&json) {
        return Err(error.to_string());
    }
    Ok(json.get("data").cloned().unwrap_or(Value::Null))
}

fn read_response(response: ureq::Response) -> HttpResponse {
    let location = response.header("location").map(str::to_string);
    let url = response.get_url().to_string();
    let _ = response.into_string();
    HttpResponse { location, url }
}

fn explain_ureq(error: UreqError) -> String {
    match error {
        UreqError::Status(code, response) => {
            let fallback = format!("{code} {}", response.status_text());
            response
                .into_string()
                .ok()
                .and_then(|text| {
                    serde_json::from_str::<Value>(&text)
                        .ok()
                        .and_then(|json| json_error(&json).map(str::to_string))
                })
                .unwrap_or(fallback)
        }
        UreqError::Transport(_) => UNREACHABLE.into(),
    }
}

pub(crate) fn query_time(time: &str) -> Result<Option<&str>, String> {
    let time = time.trim();
    if time.is_empty() {
        return Ok(None);
    }
    if period_ok(time) {
        return Ok(Some(time));
    }
    Err("time must be empty, YYYY, YYYY-Qn, or YYYY-MM".into())
}

fn period_ok(time: &str) -> bool {
    if time.len() == 4 && time.bytes().all(|b| b.is_ascii_digit()) {
        return true;
    }
    if time.len() == 7
        && time.as_bytes()[4] == b'-'
        && time.as_bytes()[5] == b'Q'
        && time[..4].bytes().all(|b| b.is_ascii_digit())
        && matches!(time.as_bytes()[6], b'1' | b'2' | b'3' | b'4')
    {
        return true;
    }
    if time.len() == 7
        && time.as_bytes()[4] == b'-'
        && time[..4].bytes().all(|b| b.is_ascii_digit())
        && time[5..].bytes().all(|b| b.is_ascii_digit())
    {
        let month: u8 = time[5..].parse().unwrap_or(0);
        return (1..=12).contains(&month);
    }
    false
}

pub(crate) fn quote_commodity(code: &str) -> Result<&str, String> {
    let bytes = code.as_bytes();
    let valid = bytes.first().is_some_and(|b| b.is_ascii_uppercase())
        && bytes.len() <= 16
        && bytes[1..].iter().all(|b| {
            b.is_ascii_uppercase() || b.is_ascii_digit() || matches!(b, b'.' | b'_' | b'-')
        });
    if valid {
        Ok(code)
    } else {
        Err("Unsupported operating currency".into())
    }
}

pub(crate) fn operating_currency(options: Option<&Value>) -> &str {
    options
        .and_then(|options| options.pointer("/operating_currency/0"))
        .and_then(Value::as_str)
        .filter(|code| !code.is_empty())
        .unwrap_or("CNY")
}

pub(crate) fn slug_from_redirect(url: &str) -> Option<String> {
    let path = url.split_once("://").map_or(url, |(_, rest)| {
        rest.split_once('/').map_or("", |(_, path)| path)
    });
    let path = path.split_once('?').map_or(path, |(path, _)| path);
    let mut parts = path.split('/').filter(|part| !part.is_empty());
    let first = parts.next()?;
    let slug = if first == "api" && parts.next() == Some("fava") {
        parts.next()?
    } else {
        first
    };
    (!matches!(slug, "api" | "document")).then(|| slug.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_time_is_omitted() {
        assert_eq!(query_time("").unwrap(), None);
        assert_eq!(query_time("  ").unwrap(), None);
        assert_eq!(query_time("2026").unwrap(), Some("2026"));
        assert_eq!(query_time("2026-Q2").unwrap(), Some("2026-Q2"));
        assert_eq!(query_time("2026-03").unwrap(), Some("2026-03"));
        assert!(query_time("2026-13").is_err());
        assert!(query_time("last-year").is_err());
    }

    #[test]
    fn slug_reads_the_first_path_segment() {
        assert_eq!(
            slug_from_redirect("http://127.0.0.1:5000/beancount/income_statement/"),
            Some("beancount".into())
        );
        assert_eq!(
            slug_from_redirect("http://127.0.0.1:5000/books/"),
            Some("books".into())
        );
        assert_eq!(
            slug_from_redirect("/api/fava/books/api/ledger_data"),
            Some("books".into())
        );
        assert_eq!(slug_from_redirect("http://127.0.0.1:5000/"), None);
        assert_eq!(slug_from_redirect("/api/"), None);
    }

    #[test]
    fn commodity_codes_stay_strict() {
        assert_eq!(quote_commodity("CNY").unwrap(), "CNY");
        assert!(quote_commodity("cny").is_err());
        assert!(quote_commodity("CNY'; DROP").is_err());
    }
}
