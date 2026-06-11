import { tool } from 'ai';
import { z } from 'zod';
import { readFile as fsReadFile, writeFile as fsWriteFile, readdir, mkdir } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function safePath(workspace: string, relativePath: string): string | null {
  const resolved = resolve(workspace, relativePath);
  if (!resolved.startsWith(workspace)) {
    return null;
  }
  return resolved;
}

export function createFileTools(workspace: string) {
  return {
    readFile: tool({
      description: 'Read the content of a file from the workspace',
      inputSchema: z.object({
        path: z.string().describe('Relative path to the file within the workspace'),
      }),
      execute: async ({ path }) => {
        const fullPath = safePath(workspace, path);
        if (!fullPath) {
          return { error: 'Path traversal not allowed' };
        }
        try {
          const content = await fsReadFile(fullPath, 'utf-8');
          return { content };
        } catch (err: any) {
          return { error: err.message };
        }
      },
    }),

    writeFile: tool({
      description: 'Write content to a file in the workspace (creates directories if needed)',
      inputSchema: z.object({
        path: z.string().describe('Relative path to the file within the workspace'),
        content: z.string().describe('Content to write to the file'),
      }),
      execute: async ({ path, content }) => {
        const fullPath = safePath(workspace, path);
        if (!fullPath) {
          return { error: 'Path traversal not allowed' };
        }
        try {
          const dir = join(fullPath, '..');
          await mkdir(dir, { recursive: true });
          await fsWriteFile(fullPath, content, 'utf-8');
          return { success: true };
        } catch (err: any) {
          return { error: err.message };
        }
      },
    }),

    listFiles: tool({
      description: 'List files and directories at a path in the workspace',
      inputSchema: z.object({
        path: z.string().describe('Relative directory path within the workspace'),
      }),
      execute: async ({ path }) => {
        const fullPath = safePath(workspace, path);
        if (!fullPath) {
          return { error: 'Path traversal not allowed' };
        }
        try {
          const files = await readdir(fullPath);
          return { files };
        } catch (err: any) {
          return { error: err.message };
        }
      },
    }),

    executeCommand: tool({
      description: 'Execute a shell command in the workspace directory',
      inputSchema: z.object({
        command: z.string().describe('Shell command to execute'),
      }),
      execute: async ({ command }) => {
        try {
          const { stdout, stderr } = await execFileAsync('bash', ['-c', command], {
            cwd: workspace,
            timeout: 30000,
          });
          return { stdout, stderr, exitCode: 0 };
        } catch (err: any) {
          return {
            stdout: err.stdout ?? '',
            stderr: err.stderr ?? err.message,
            exitCode: err.code ?? 1,
          };
        }
      },
    }),
  };
}
