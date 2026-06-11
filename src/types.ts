export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  status: 'pending' | 'in_progress' | 'done' | 'failed';
  inputFiles: string[];
  outputFiles: string[];
}

export interface ReviewResult {
  approved: boolean;
  issues: string[];
  suggestions: string[];
}

export interface AgentConfig {
  name: string;
  workspace: string;
  apiKey: string;
  baseURL: string;
  model: string;
}

export type AgentRole = 'orchestrator' | 'developer' | 'tester' | 'reviewer';
