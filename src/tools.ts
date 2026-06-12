import { readFile as fsReadFile, writeFile as fsWriteFile, readdir, mkdir, realpath } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export interface ToolSet {
  definitions: any[];
  executors: Record<string, (args: Record<string, any>) => Promise<any>>;
}

async function safePath(workspace: string, relativePath: string): Promise<string | null> {
  const resolvedWorkspace = await realpath(workspace);
  const resolved = await realpath(resolve(workspace, relativePath)).catch(() => resolve(workspace, relativePath));
  const resolvedStr = resolved.toString();
  if (!resolvedStr.startsWith(resolvedWorkspace + '/') && resolvedStr !== resolvedWorkspace) {
    return null;
  }
  return resolvedStr;
}

export function createFileTools(workspace: string): ToolSet {
  return {
    definitions: [
      {
        type: 'function',
        function: {
          name: 'writeFile',
          description: 'Write content to a file in the workspace (creates directories if needed)',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'Relative path to the file within the workspace' },
              content: { type: 'string', description: 'Content to write to the file' },
            },
            required: ['path', 'content'],
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'readFile',
          description: 'Read the content of a file from the workspace',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'Relative path to the file within the workspace' },
            },
            required: ['path'],
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'listFiles',
          description: 'List files and directories at a path in the workspace',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'Relative directory path within the workspace' },
            },
            required: ['path'],
            additionalProperties: false,
          },
        },
      },
    ],
    executors: {
      writeFile: async ({ path, content }) => {
        const fullPath = await safePath(workspace, path);
        if (!fullPath) return { error: 'Path traversal not allowed' };
        try {
          await mkdir(dirname(fullPath), { recursive: true });
          await fsWriteFile(fullPath, content, 'utf-8');
          return { success: true };
        } catch (err: any) {
          return { error: err.message };
        }
      },
      readFile: async ({ path }) => {
        const fullPath = await safePath(workspace, path);
        if (!fullPath) return { error: 'Path traversal not allowed' };
        try {
          const content = await fsReadFile(fullPath, 'utf-8');
          return { content };
        } catch (err: any) {
          return { error: err.message };
        }
      },
      listFiles: async ({ path }) => {
        const fullPath = await safePath(workspace, path);
        if (!fullPath) return { error: 'Path traversal not allowed' };
        try {
          const files = await readdir(fullPath);
          return { files };
        } catch (err: any) {
          return { error: err.message };
        }
      },
    },
  };
}

export function createReadWriteTools(workspace: string): ToolSet {
  return {
    definitions: [
      {
        type: 'function',
        function: {
          name: 'readFile',
          description: 'Read the content of a file from the workspace',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'Relative path to the file within the workspace' },
            },
            required: ['path'],
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'writeFile',
          description: 'Write content to a file in the workspace (creates directories if needed)',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'Relative path to the file within the workspace' },
              content: { type: 'string', description: 'Content to write to the file' },
            },
            required: ['path', 'content'],
            additionalProperties: false,
          },
        },
      },
    ],
    executors: {
      readFile: async ({ path }) => {
        const fullPath = await safePath(workspace, path);
        if (!fullPath) return { error: 'Path traversal not allowed' };
        try {
          const content = await fsReadFile(fullPath, 'utf-8');
          return { content };
        } catch (err: any) {
          return { error: err.message };
        }
      },
      writeFile: async ({ path, content }) => {
        const fullPath = await safePath(workspace, path);
        if (!fullPath) return { error: 'Path traversal not allowed' };
        try {
          await mkdir(dirname(fullPath), { recursive: true });
          await fsWriteFile(fullPath, content, 'utf-8');
          return { success: true };
        } catch (err: any) {
          return { error: err.message };
        }
      },
    },
  };
}

export function createReadTools(workspace: string): ToolSet {
  return {
    definitions: [
      {
        type: 'function',
        function: {
          name: 'readFile',
          description: 'Read the content of a file from the workspace',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'Relative path to the file within the workspace' },
            },
            required: ['path'],
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'listFiles',
          description: 'List files and directories at a path in the workspace',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'Relative directory path within the workspace' },
            },
            required: ['path'],
            additionalProperties: false,
          },
        },
      },
    ],
    executors: {
      readFile: async ({ path }) => {
        const fullPath = await safePath(workspace, path);
        if (!fullPath) return { error: 'Path traversal not allowed' };
        try {
          const content = await fsReadFile(fullPath, 'utf-8');
          return { content };
        } catch (err: any) {
          return { error: err.message };
        }
      },
      listFiles: async ({ path }) => {
        const fullPath = await safePath(workspace, path);
        if (!fullPath) return { error: 'Path traversal not allowed' };
        try {
          const files = await readdir(fullPath);
          return { files };
        } catch (err: any) {
          return { error: err.message };
        }
      },
    },
  };
}
