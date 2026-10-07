mod card;
mod fava;
mod fava_tools;
mod handbook;
mod policies;
mod store;
mod tools;

use std::path::PathBuf;

use rmcp::handler::server::wrapper::Parameters;
use rmcp::{Json, ServerHandler, ServiceExt, tool, tool_handler, tool_router};
use serde::Serialize;

use card::{Card, without_trailing_newline};
use fava_tools::{
    BqlInput, DocumentsBody, FavaStatusBody, LedgerBody, QueryBody, ReportBody, TimeInput,
    get_balance_sheet_card, get_fava_card, get_income_statement_card, get_journal_card,
    get_ledger_card, get_trial_balance_card, list_documents_card, run_bql_card,
};
use handbook::{HandbookBody, HandbookInput, get_handbook_card};
use policies::{PoliciesBody, PolicyBody, PolicyInput, get_policy_card, list_policies_card};
use tools::{
    CheckBody, ConnectionBody, EmptyInput, InitLedgerInput, WriteBody, check_ledger_card,
    get_connection_card, init_ledger_card,
};

fn args_request_mcp(args: impl IntoIterator<Item = impl AsRef<str>>) -> bool {
    args.into_iter().skip(1).any(|arg| arg.as_ref() == "mcp")
}

pub fn is_mcp_launch() -> bool {
    args_request_mcp(std::env::args())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpHostConfig {
    pub command: String,
    pub args: Vec<String>,
}

fn mcp_host_config_for(executable: PathBuf) -> Result<McpHostConfig, String> {
    let command = executable
        .into_os_string()
        .into_string()
        .map_err(|_| "path".to_string())?;
    Ok(McpHostConfig {
        command,
        args: vec!["mcp".to_string()],
    })
}

#[tauri::command]
pub fn mcp_host_config() -> Result<McpHostConfig, String> {
    let executable = std::env::current_exe().map_err(|error| error.to_string())?;
    mcp_host_config_for(executable)
}

#[derive(Clone, Default)]
struct LedgerTools;

#[tool_router]
impl LedgerTools {
    #[tool(
        description = include_str!("prompts/get_connection.txt"),
        annotations(read_only_hint = true)
    )]
    fn get_connection(
        &self,
        Parameters(_input): Parameters<EmptyInput>,
    ) -> Result<Json<Card<ConnectionBody>>, String> {
        Ok(Json(get_connection_card(None)?))
    }

    #[tool(
        description = include_str!("prompts/init_ledger.txt"),
        annotations(read_only_hint = false)
    )]
    fn init_ledger(
        &self,
        Parameters(input): Parameters<InitLedgerInput>,
    ) -> Result<Json<Card<WriteBody>>, String> {
        Ok(Json(init_ledger_card(None, input)?))
    }

    #[tool(
        description = include_str!("prompts/check_ledger.txt"),
        annotations(read_only_hint = true)
    )]
    fn check_ledger(
        &self,
        Parameters(_input): Parameters<EmptyInput>,
    ) -> Result<Json<Card<CheckBody>>, String> {
        Ok(Json(check_ledger_card(None)?))
    }

    #[tool(
        description = include_str!("prompts/get_fava.txt"),
        annotations(read_only_hint = true)
    )]
    fn get_fava(
        &self,
        Parameters(_input): Parameters<EmptyInput>,
    ) -> Result<Json<Card<FavaStatusBody>>, String> {
        Ok(Json(get_fava_card(None)?))
    }

    #[tool(
        description = include_str!("prompts/get_ledger.txt"),
        annotations(read_only_hint = true)
    )]
    fn get_ledger(
        &self,
        Parameters(_input): Parameters<EmptyInput>,
    ) -> Result<Json<Card<LedgerBody>>, String> {
        Ok(Json(get_ledger_card(None)?))
    }

    #[tool(
        description = include_str!("prompts/run_bql.txt"),
        annotations(read_only_hint = true)
    )]
    fn run_bql(
        &self,
        Parameters(input): Parameters<BqlInput>,
    ) -> Result<Json<Card<QueryBody>>, String> {
        Ok(Json(run_bql_card(None, input)?))
    }

    #[tool(
        description = include_str!("prompts/get_trial_balance.txt"),
        annotations(read_only_hint = true)
    )]
    fn get_trial_balance(
        &self,
        Parameters(input): Parameters<TimeInput>,
    ) -> Result<Json<Card<ReportBody>>, String> {
        Ok(Json(get_trial_balance_card(None, input)?))
    }

    #[tool(
        description = include_str!("prompts/get_balance_sheet.txt"),
        annotations(read_only_hint = true)
    )]
    fn get_balance_sheet(
        &self,
        Parameters(input): Parameters<TimeInput>,
    ) -> Result<Json<Card<ReportBody>>, String> {
        Ok(Json(get_balance_sheet_card(None, input)?))
    }

    #[tool(
        description = include_str!("prompts/get_income_statement.txt"),
        annotations(read_only_hint = true)
    )]
    fn get_income_statement(
        &self,
        Parameters(input): Parameters<TimeInput>,
    ) -> Result<Json<Card<ReportBody>>, String> {
        Ok(Json(get_income_statement_card(None, input)?))
    }

    #[tool(
        description = include_str!("prompts/get_journal.txt"),
        annotations(read_only_hint = true)
    )]
    fn get_journal(
        &self,
        Parameters(input): Parameters<TimeInput>,
    ) -> Result<Json<Card<QueryBody>>, String> {
        Ok(Json(get_journal_card(None, input)?))
    }

    #[tool(
        description = include_str!("prompts/list_documents.txt"),
        annotations(read_only_hint = true)
    )]
    fn list_documents(
        &self,
        Parameters(_input): Parameters<EmptyInput>,
    ) -> Result<Json<Card<DocumentsBody>>, String> {
        Ok(Json(list_documents_card(None)?))
    }

    #[tool(
        description = include_str!("prompts/get_handbook.txt"),
        annotations(read_only_hint = true)
    )]
    fn get_handbook(
        &self,
        Parameters(input): Parameters<HandbookInput>,
    ) -> Result<Json<Card<HandbookBody>>, String> {
        Ok(Json(get_handbook_card(input)?))
    }

    #[tool(
        description = include_str!("prompts/list_policies.txt"),
        annotations(read_only_hint = true)
    )]
    fn list_policies(
        &self,
        Parameters(_input): Parameters<EmptyInput>,
    ) -> Result<Json<Card<PoliciesBody>>, String> {
        Ok(Json(list_policies_card(None)?))
    }

    #[tool(
        description = include_str!("prompts/get_policy.txt"),
        annotations(read_only_hint = true)
    )]
    fn get_policy(
        &self,
        Parameters(input): Parameters<PolicyInput>,
    ) -> Result<Json<Card<PolicyBody>>, String> {
        Ok(Json(get_policy_card(None, input)?))
    }
}

pub fn run_mcp() -> Result<(), String> {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_io()
        .enable_time()
        .build()
        .map_err(|error| error.to_string())?;
    runtime.block_on(async {
        let service = LedgerTools
            .serve(rmcp::transport::stdio())
            .await
            .map_err(|error| error.to_string())?;
        service.waiting().await.map_err(|error| error.to_string())?;
        Ok(())
    })
}

const SERVER_DESCRIPTION: &str =
    without_trailing_newline(include_str!("prompts/server_description.txt"));

const SERVER_INSTRUCTIONS: &str = concat!(
    include_str!("prompts/server_description.txt"),
    include_str!("prompts/server_report.txt"),
);

#[tool_handler(name = "BeanDesk")]
impl ServerHandler for LedgerTools {
    fn get_info(&self) -> rmcp::model::ServerConfig {
        rmcp::model::ServerConfig::new(
            rmcp::model::ServerCapabilities::builder()
                .enable_tools()
                .build(),
        )
        .with_server_info(
            rmcp::model::Implementation::new("BeanDesk", env!("CARGO_PKG_VERSION"))
                .with_description(SERVER_DESCRIPTION),
        )
        .with_instructions(SERVER_INSTRUCTIONS)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const BANNED: &[&str] = &[
        "提问工具",
        "文本代码块",
        "内置浏览器",
        "Cursor",
        "opc-ledger",
    ];

    #[test]
    fn args_request_mcp_matches_only_a_bare_mcp_argument() {
        assert!(args_request_mcp(["BeanDesk", "mcp"]));
        assert!(!args_request_mcp(["BeanDesk"]));
        assert!(!args_request_mcp(["BeanDesk", "--mcp"]));
        assert!(!args_request_mcp(["mcp"]));
    }

    #[test]
    fn mcp_host_config_points_at_the_executable_with_mcp_args() {
        let config = mcp_host_config_for(PathBuf::from(
            "/Applications/BeanDesk.app/Contents/MacOS/BeanDesk",
        ))
        .unwrap();
        assert_eq!(
            config.command,
            "/Applications/BeanDesk.app/Contents/MacOS/BeanDesk"
        );
        assert_eq!(config.args, ["mcp"]);
    }

    #[test]
    fn agent_contract_keeps_layers_apart() {
        let descriptions = [
            include_str!("prompts/get_connection.txt"),
            include_str!("prompts/init_ledger.txt"),
            include_str!("prompts/check_ledger.txt"),
            include_str!("prompts/get_fava.txt"),
            include_str!("prompts/get_ledger.txt"),
            include_str!("prompts/run_bql.txt"),
            include_str!("prompts/get_trial_balance.txt"),
            include_str!("prompts/get_balance_sheet.txt"),
            include_str!("prompts/get_income_statement.txt"),
            include_str!("prompts/get_journal.txt"),
            include_str!("prompts/list_documents.txt"),
            include_str!("prompts/get_handbook.txt"),
            include_str!("prompts/list_policies.txt"),
            include_str!("prompts/get_policy.txt"),
        ];
        for text in std::iter::once(SERVER_INSTRUCTIONS).chain(descriptions) {
            for banned in BANNED {
                assert!(
                    !text.contains(banned),
                    "{banned} must stay out of agent-facing copy"
                );
            }
        }
        assert!(!SERVER_INSTRUCTIONS.contains("get_connection"));
        assert!(!SERVER_INSTRUCTIONS.contains("init_ledger"));
        assert!(!SERVER_INSTRUCTIONS.contains("run_bql"));
        assert!(!SERVER_INSTRUCTIONS.contains("confirmWrite"));
        assert!(!SERVER_INSTRUCTIONS.contains("list_policies"));
        assert!(!SERVER_INSTRUCTIONS.contains("get_policy"));
        for description in descriptions {
            assert!(!description.contains("confirmWrite"));
        }
    }
}
