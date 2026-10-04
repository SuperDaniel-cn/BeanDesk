import { invoke } from '@tauri-apps/api/core'

export type McpHostConfig = {
  command: string
  args: string[]
}

export async function loadMcpHostConfig(): Promise<McpHostConfig> {
  return invoke<McpHostConfig>('mcp_host_config')
}

export function mcpHostConfigText(config: McpHostConfig): string {
  return JSON.stringify({ command: config.command, args: config.args }, null, 2)
}
