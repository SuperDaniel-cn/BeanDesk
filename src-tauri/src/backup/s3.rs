use std::path::Path;

use hmac::{Hmac, KeyInit, Mac};
use reqwest::blocking::Client;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use sha2::{Digest, Sha256};
use time::OffsetDateTime;

use super::settings::{S3Settings, is_archive_name};

type HmacSha256 = Hmac<Sha256>;

pub fn put_object(s3: &S3Settings, key: &str, body: &[u8]) -> Result<(), String> {
    let request = signed(s3, "PUT", &object_path(s3, key), "", body, "application/octet-stream")?;
    let response = request
        .send()
        .map_err(|_| "s3".to_string())?;
    if response.status().is_success() {
        Ok(())
    } else {
        Err("s3".to_string())
    }
}

pub fn test_access(s3: &S3Settings) -> Result<(), String> {
    list_keys(s3).map(|_| ())
}

pub fn upload_archive(s3: &S3Settings, archive: &Path, keep: u32) -> Result<String, String> {
    let name = archive
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "s3".to_string())?;
    let key = object_key(&s3.prefix, name);
    let body = std::fs::read(archive).map_err(|error| error.to_string())?;
    put_object(s3, &key, &body)?;
    prune_remote(s3, keep)?;
    Ok(key)
}

fn prune_remote(s3: &S3Settings, keep: u32) -> Result<(), String> {
    let mut keys: Vec<String> = list_keys(s3)?
        .into_iter()
        .filter(|key| {
            key.rsplit('/')
                .next()
                .is_some_and(|name| is_archive_name(name))
        })
        .collect();
    if keys.len() <= keep as usize {
        return Ok(());
    }
    keys.sort();
    let excess = keys.len() - keep as usize;
    for key in keys.into_iter().take(excess) {
        let _ = delete_object(s3, &key);
    }
    Ok(())
}

fn list_keys(s3: &S3Settings) -> Result<Vec<String>, String> {
    let query = if s3.prefix.is_empty() {
        "list-type=2".to_string()
    } else {
        format!("list-type=2&prefix={}", uri_encode(&format!("{}/", s3.prefix), true))
    };
    let path = if s3.path_style_access {
        format!("/{}/", s3.bucket_name)
    } else {
        "/".to_string()
    };
    let request = signed(s3, "GET", &path, &query, b"", "")?;
    let response = request.send().map_err(|_| "s3".to_string())?;
    if !response.status().is_success() {
        return Err("s3".to_string());
    }
    let xml = response.text().map_err(|_| "s3".to_string())?;
    Ok(parse_keys(&xml))
}

fn delete_object(s3: &S3Settings, key: &str) -> Result<(), String> {
    let request = signed(s3, "DELETE", &object_path(s3, key), "", b"", "")?;
    let response = request.send().map_err(|_| "s3".to_string())?;
    if response.status().is_success() || response.status().as_u16() == 204 {
        Ok(())
    } else {
        Err("s3".to_string())
    }
}

fn object_key(prefix: &str, name: &str) -> String {
    if prefix.is_empty() {
        name.to_string()
    } else {
        format!("{prefix}/{name}")
    }
}

fn object_path(s3: &S3Settings, key: &str) -> String {
    if s3.path_style_access {
        format!("/{}/{}", s3.bucket_name, key)
    } else {
        format!("/{key}")
    }
}

fn signed(
    s3: &S3Settings,
    method: &str,
    path: &str,
    query: &str,
    body: &[u8],
    content_type: &str,
) -> Result<reqwest::blocking::RequestBuilder, String> {
    let now = OffsetDateTime::now_utc();
    let amz_date = format!(
        "{:04}{:02}{:02}T{:02}{:02}{:02}Z",
        now.year(),
        u8::from(now.month()),
        now.day(),
        now.hour(),
        now.minute(),
        now.second()
    );
    let date_stamp = &amz_date[..8];
    let host = request_host(s3)?;
    let canonical_uri = uri_encode(path, false);
    let url = if query.is_empty() {
        format!("https://{host}{canonical_uri}")
    } else {
        format!("https://{host}{canonical_uri}?{query}")
    };
    let payload_hash = hex::encode(Sha256::digest(body));
    let mut headers: Vec<(String, String)> = vec![
        ("host".to_string(), host),
        ("x-amz-content-sha256".to_string(), payload_hash.clone()),
        ("x-amz-date".to_string(), amz_date.clone()),
    ];
    if !content_type.is_empty() {
        headers.push(("content-type".to_string(), content_type.to_string()));
    }
    headers.sort_by(|left, right| left.0.cmp(&right.0));
    let signed_headers = headers
        .iter()
        .map(|(name, _)| name.as_str())
        .collect::<Vec<_>>()
        .join(";");
    let canonical_headers = headers
        .iter()
        .map(|(name, value)| format!("{name}:{value}\n"))
        .collect::<String>();
    let canonical_request = format!(
        "{method}\n{canonical_uri}\n{query}\n{canonical_headers}\n{signed_headers}\n{payload_hash}"
    );
    let credential_scope = format!("{date_stamp}/{}/s3/aws4_request", s3.region);
    let string_to_sign = format!(
        "AWS4-HMAC-SHA256\n{amz_date}\n{credential_scope}\n{}",
        hex::encode(Sha256::digest(canonical_request.as_bytes()))
    );
    let signing_key = signing_key(&s3.secret_access_key, date_stamp, &s3.region)?;
    let signature = hex::encode(hmac_sha256(&signing_key, string_to_sign.as_bytes())?);
    let authorization = format!(
        "AWS4-HMAC-SHA256 Credential={}/{credential_scope}, SignedHeaders={signed_headers}, Signature={signature}",
        s3.access_key_id
    );
    let client = Client::builder()
        .https_only(true)
        .build()
        .map_err(|_| "s3".to_string())?;
    let mut map = HeaderMap::new();
    for (name, value) in headers {
        map.insert(
            HeaderName::from_bytes(name.as_bytes()).map_err(|_| "s3".to_string())?,
            HeaderValue::from_str(&value).map_err(|_| "s3".to_string())?,
        );
    }
    map.insert(
        HeaderName::from_static("authorization"),
        HeaderValue::from_str(&authorization).map_err(|_| "s3".to_string())?,
    );
    let builder = match method {
        "PUT" => client.put(url).body(body.to_vec()),
        "DELETE" => client.delete(url),
        _ => client.get(url),
    };
    Ok(builder.headers(map))
}

fn request_host(s3: &S3Settings) -> Result<String, String> {
    let url = url::Url::parse(&s3.endpoint).map_err(|_| "s3-endpoint".to_string())?;
    let host = url.host_str().ok_or_else(|| "s3-endpoint".to_string())?;
    if s3.path_style_access {
        Ok(host_with_port(&url, host))
    } else {
        let virtual_host = format!("{}.{}", s3.bucket_name, host);
        if let Some(port) = url.port() {
            Ok(format!("{virtual_host}:{port}"))
        } else {
            Ok(virtual_host)
        }
    }
}

fn host_with_port(url: &url::Url, host: &str) -> String {
    match url.port() {
        Some(port) => format!("{host}:{port}"),
        None => host.to_string(),
    }
}

fn signing_key(secret: &str, date: &str, region: &str) -> Result<Vec<u8>, String> {
    let mut key = hmac_sha256(format!("AWS4{secret}").as_bytes(), date.as_bytes())?;
    key = hmac_sha256(&key, region.as_bytes())?;
    key = hmac_sha256(&key, b"s3")?;
    hmac_sha256(&key, b"aws4_request")
}

fn hmac_sha256(key: &[u8], data: &[u8]) -> Result<Vec<u8>, String> {
    let mut mac = HmacSha256::new_from_slice(key).map_err(|_| "s3".to_string())?;
    mac.update(data);
    Ok(mac.finalize().into_bytes().to_vec())
}

fn uri_encode(value: &str, encode_slash: bool) -> String {
    let mut out = String::new();
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char);
            }
            b'/' if !encode_slash => out.push('/'),
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

fn parse_keys(xml: &str) -> Vec<String> {
    let mut keys = Vec::new();
    let mut rest = xml;
    while let Some(start) = rest.find("<Key>") {
        rest = &rest[start + 5..];
        let Some(end) = rest.find("</Key>") else {
            break;
        };
        keys.push(rest[..end].to_string());
        rest = &rest[end + 6..];
    }
    keys
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn path_style_puts_the_bucket_in_the_path() {
        let s3 = S3Settings {
            bucket_name: "books".to_string(),
            path_style_access: true,
            prefix: "desk".to_string(),
            ..S3Settings::default()
        };
        assert_eq!(object_path(&s3, "a.enc"), "/books/a.enc");
        assert_eq!(object_key("desk", "a.enc"), "desk/a.enc");
        let virtual_host = S3Settings {
            path_style_access: false,
            bucket_name: "books".to_string(),
            ..S3Settings::default()
        };
        assert_eq!(object_path(&virtual_host, "a.enc"), "/a.enc");
    }

    #[test]
    fn reads_object_keys_from_list_xml() {
        let xml = "<ListBucketResult><Contents><Key>desk/beandesk-backup-1.tar.gz.enc</Key></Contents><Contents><Key>desk/note.txt</Key></Contents></ListBucketResult>";
        assert_eq!(
            parse_keys(xml),
            vec![
                "desk/beandesk-backup-1.tar.gz.enc".to_string(),
                "desk/note.txt".to_string()
            ]
        );
    }
}
