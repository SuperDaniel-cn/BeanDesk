use std::time::Duration;

use serde_json::Value;
use ureq::{Agent, AgentBuilder, Error as UreqError};

const DEFAULT_SLUG: &str = "beancount";
const TIMEOUT: Duration = Duration::from_secs(8);

#[derive(Clone)]
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
    pub(crate) fn new(origin: &str) -> Result<Self, String> {
        let origin = origin.trim().trim_end_matches('/');
        if origin.is_empty() {
            return Err("No Fava origin in Settings.".into());
        }
        Ok(Self {
            origin: origin.to_string(),
            api: AgentBuilder::new().timeout(TIMEOUT).redirects(4).build(),
            probe: AgentBuilder::new().timeout(TIMEOUT).redirects(0).build(),
        })
    }

    pub(crate) fn resolve_slug(&self) -> Result<String, String> {
        Ok(self.resolve_ledger()?.0)
    }

    pub(crate) fn resolve_ledger(&self) -> Result<(String, Value), String> {
        match self.get_data(&format!("/{DEFAULT_SLUG}/api/ledger_data"), &[]) {
            Ok(data) => return Ok((DEFAULT_SLUG.to_string(), data)),
            Err(error) if error == "Settings origin is not answering" => return Err(error),
            Err(_) => {}
        }
        let root = self.probe_root()?;
        let discovered = slug_from_redirect(&root.location.unwrap_or_default())
            .or_else(|| slug_from_redirect(&root.url));
        let Some(slug) = discovered else {
            return Err("Fava slug could not be determined.".into());
        };
        let data = self.get_data(&format!("/{slug}/api/ledger_data"), &[])?;
        Ok((slug, data))
    }

    pub(crate) fn get_data(&self, path: &str, query: &[(&str, &str)]) -> Result<Value, String> {
        let envelope = self.api_get_query(path, query)?;
        if let Some(error) = envelope.get("error").and_then(Value::as_str) {
            if !error.is_empty() {
                return Err(error.to_string());
            }
        }
        Ok(envelope.get("data").cloned().unwrap_or(Value::Null))
    }

    fn api_get_query(&self, path: &str, query: &[(&str, &str)]) -> Result<Value, String> {
        let url = format!("{}{path}", self.origin);
        let mut request = self.api.get(&url);
        for (key, value) in query {
            request = request.query(key, value);
        }
        let response = request.call().map_err(explain_ureq)?;
        let status = response.status();
        let text = response.into_string().map_err(|error| error.to_string())?;
        let json: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
        if !(200..300).contains(&status) {
            let detail = json
                .get("error")
                .and_then(Value::as_str)
                .map(str::to_string)
                .unwrap_or_else(|| format!("{status}"));
            return Err(detail);
        }
        Ok(json)
    }

    fn probe_root(&self) -> Result<HttpResponse, String> {
        let url = format!("{}/", self.origin);
        match self.probe.get(&url).call() {
            Ok(response) => Ok(read_response(response, url)),
            Err(UreqError::Status(_, response)) => Ok(read_response(response, url)),
            Err(error) => Err(explain_ureq(error)),
        }
    }
}

fn read_response(response: ureq::Response, fallback: String) -> HttpResponse {
    let location = response.header("location").map(str::to_string);
    let url = response.get_url().to_string();
    let _ = response.into_string();
    HttpResponse {
        location,
        url: if url.is_empty() { fallback } else { url },
    }
}

fn explain_ureq(error: UreqError) -> String {
    match error {
        UreqError::Status(code, response) => response
            .into_string()
            .ok()
            .and_then(|text| {
                serde_json::from_str::<Value>(&text).ok().and_then(|json| {
                    json.get("error")
                        .and_then(Value::as_str)
                        .map(str::to_string)
                })
            })
            .unwrap_or_else(|| format!("{code}")),
        UreqError::Transport(_) => "Settings origin is not answering".into(),
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

pub(crate) fn operating_currency(options: &Value) -> String {
    options
        .pointer("/operating_currency/0")
        .and_then(Value::as_str)
        .filter(|code| !code.is_empty())
        .unwrap_or("CNY")
        .to_string()
}

pub(crate) fn slug_from_redirect(url: &str) -> Option<String> {
    let path = url.split_once("://").map_or(url, |(_, rest)| {
        rest.split_once('/').map_or("", |(_, path)| path)
    });
    let path = path.split('?').next().unwrap_or(path);
    let parts: Vec<&str> = path.split('/').filter(|part| !part.is_empty()).collect();
    if parts.first() == Some(&"api") && parts.get(1) == Some(&"fava") {
        return parts
            .get(2)
            .copied()
            .filter(|slug| *slug != "api" && *slug != "document")
            .map(str::to_string);
    }
    parts
        .first()
        .copied()
        .filter(|slug| *slug != "api" && *slug != "document")
        .map(str::to_string)
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
