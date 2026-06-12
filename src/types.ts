export interface AgentConfig {
  name: string;
  workspace: string;
  apiKey: string;
  baseURL: string;
  model: string;
  verbose?: boolean;
}
