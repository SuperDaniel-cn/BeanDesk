use std::collections::BTreeMap;

use serde::Serialize;
use serde_json::{Value, json};

use super::LedgerTools;
use super::card::Card;
use super::fava_tools::{DocumentsBody, LedgerBody, QueryBody, ReportBody, get_fava_card};
use super::handbook::{HandbookInput, get_handbook_card};
use super::policies::{PolicyInput, get_policy_card, list_policies_card};
use super::policy_lint::{PolicyViolation, Severity};
use super::tools::{
    CheckBody, InitLedgerInput, fixture_store, get_connection_card, init_ledger_card, temp_dir,
};

#[test]
fn structured_content_keeps_output_schema_required_fields() {
    let samples = sample_payloads();
    let tools = LedgerTools::tool_router().list_all();
    let schemas: BTreeMap<&str, _> = tools
        .iter()
        .map(|tool| {
            (
                tool.name.as_ref(),
                tool.output_schema
                    .as_ref()
                    .unwrap_or_else(|| panic!("{} is missing outputSchema", tool.name)),
            )
        })
        .collect();
    assert_eq!(
        samples.keys().copied().collect::<Vec<_>>(),
        schemas.keys().copied().collect::<Vec<_>>()
    );

    for (name, payloads) in &samples {
        let schema = Value::Object(schemas[name].as_ref().clone());
        for payload in payloads {
            let missing = missing_required(&schema, payload);
            assert!(missing.is_empty(), "{name}: {}", missing.join("; "));
        }
    }
}

fn sample_payloads() -> BTreeMap<&'static str, Vec<Value>> {
    let root = temp_dir("schema");
    std::fs::create_dir_all(root.join("policies")).unwrap();
    std::fs::write(
        root.join("policies/README.md"),
        "# Bookkeeping policies\nGuide.\n",
    )
    .unwrap();
    let store = fixture_store(&root, "local");
    let mut down = store.clone();
    down["connection"]["local"]["origin"] = json!("http://127.0.0.1:1");

    let connection = json_card(get_connection_card(Some(&store)).unwrap());
    let pending = json_card(init_ledger_card(Some(&store), InitLedgerInput::default()).unwrap());
    let fava = json_card(get_fava_card(Some(&down)).unwrap());
    let handbook_catalog = json_card(get_handbook_card(HandbookInput::default()).unwrap());
    let handbook_page = json_card(
        get_handbook_card(HandbookInput {
            page: "mcp".into(),
            locale: "zh-CN".into(),
        })
        .unwrap(),
    );
    let policies = json_card(list_policies_card(Some(&store)).unwrap());
    let policy = json_card(
        get_policy_card(
            Some(&store),
            PolicyInput {
                name: "README.md".into(),
            },
        )
        .unwrap(),
    );
    let _ = std::fs::remove_dir_all(&root);

    let check_empty = json_card(Card::new(
        "bean-check passed on the Settings folder.",
        CheckBody {
            ok: true,
            code: 0,
            preview: String::new(),
            directory: "/tmp/ledger".into(),
            policy_ok: None,
            violations: Vec::new(),
        },
    ));
    let check_hits = json_card(Card::new(
        "Policy errors.",
        CheckBody {
            ok: false,
            code: 1,
            preview: "hit".into(),
            directory: "/tmp/ledger".into(),
            policy_ok: Some(false),
            violations: vec![PolicyViolation {
                file: "data/2026/2026-03.bean".into(),
                line: 1,
                rule_id: "repay-narration".into(),
                message: "narration must mention the loan".into(),
                severity: Severity::Error,
            }],
        },
    ));
    let ledger = json_card(Card::new(
        "Ledger uses CNY.",
        LedgerBody {
            title: "Ledger".into(),
            currency: "CNY".into(),
            account_count: 0,
            error_count: 0,
            accounts: Vec::new(),
            errors: Vec::new(),
            slug: "beancount".into(),
        },
    ));
    let query = json_card(Card::new(
        "BQL returned no rows.",
        QueryBody {
            row_count: 0,
            truncated: false,
            types: Vec::new(),
            rows: Vec::new(),
            time: String::new(),
            slug: "beancount".into(),
        },
    ));
    let report = json_card(Card::new(
        "trial balance for all time. Roots: none.",
        ReportBody {
            time: String::new(),
            slug: "beancount".into(),
            roots: Vec::new(),
            data: json!({}),
        },
    ));
    let documents = json_card(Card::new(
        "0 documents in the Fava catalogue.",
        DocumentsBody {
            count: 0,
            truncated: false,
            documents: Vec::new(),
            slug: "beancount".into(),
        },
    ));

    BTreeMap::from([
        ("get_connection", vec![connection]),
        ("init_ledger", vec![pending]),
        ("check_ledger", vec![check_empty, check_hits]),
        ("get_fava", vec![fava]),
        ("get_ledger", vec![ledger]),
        ("run_bql", vec![query.clone()]),
        ("get_journal", vec![query]),
        ("get_trial_balance", vec![report.clone()]),
        ("get_balance_sheet", vec![report.clone()]),
        ("get_income_statement", vec![report]),
        ("list_documents", vec![documents]),
        ("get_handbook", vec![handbook_catalog, handbook_page]),
        ("list_policies", vec![policies]),
        ("get_policy", vec![policy]),
    ])
}

fn json_card<T: Serialize>(card: Card<T>) -> Value {
    serde_json::to_value(&card).expect("card")
}

fn missing_required(root: &Value, instance: &Value) -> Vec<String> {
    let mut missing = Vec::new();
    walk(root, root, instance, "data", &mut missing);
    missing
}

fn walk(root: &Value, schema: &Value, instance: &Value, path: &str, missing: &mut Vec<String>) {
    let schema = resolve(root, schema);
    if let Some(required) = schema.get("required").and_then(Value::as_array) {
        let Some(object) = instance.as_object() else {
            missing.push(format!("{path} must be an object"));
            return;
        };
        for key in required.iter().filter_map(Value::as_str) {
            if !object.contains_key(key) {
                missing.push(format!("{path} must have required property '{key}'"));
            }
        }
    }
    if let Some(properties) = schema.get("properties").and_then(Value::as_object) {
        if let Some(object) = instance.as_object() {
            for (key, child) in properties {
                if let Some(value) = object.get(key) {
                    walk(root, child, value, &format!("{path}.{key}"), missing);
                }
            }
        }
        return;
    }
    if let (Some(items), Some(rows)) = (schema.get("items"), instance.as_array()) {
        for (index, row) in rows.iter().enumerate() {
            walk(root, items, row, &format!("{path}[{index}]"), missing);
        }
    }
}

fn resolve<'a>(root: &'a Value, schema: &'a Value) -> &'a Value {
    match schema.get("$ref").and_then(Value::as_str) {
        Some(pointer) => root
            .pointer(pointer.trim_start_matches('#'))
            .unwrap_or_else(|| panic!("missing schema ref {pointer}")),
        None => schema,
    }
}
