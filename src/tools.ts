import { readFile as fsReadFile, writeFile as fsWriteFile, readdir, mkdir, realpath } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ToolSet {
  definitions: ToolDefinition[];
  executors: Record<string, (args: Record<string, unknown>) => Promise<Record<string, unknown>>>;
}

function createSafePath(workspace: string): (relativePath: string) => Promise<string | null> {
  let resolvedWorkspacePromise: Promise<string> | null = null;

  return async (relativePath: string) => {
    if (!resolvedWorkspacePromise) {
      resolvedWorkspacePromise = realpath(workspace);
    }
    const resolvedWorkspace = await resolvedWorkspacePromise;

    const resolvedStr = resolve(workspace, relativePath);
    const resolvedNorm = resolve(resolvedStr);

    if (!resolvedNorm.startsWith(resolvedWorkspace + '/') && resolvedNorm !== resolvedWorkspace) {
      return null;
    }
    return resolvedNorm;
  };
}

function writeFileExecutor(safePath: ReturnType<typeof createSafePath>) {
  return async (args: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const path = args['path'] as string | undefined;
    const content = args['content'] as string | undefined;
    if (!path) return { error: 'Missing required argument: path' };
    if (content === undefined) return { error: 'Missing required argument: content' };
    const fullPath = await safePath(path);
    if (!fullPath) return { error: 'Path traversal not allowed' };
    try {
      await mkdir(dirname(fullPath), { recursive: true });
      await fsWriteFile(fullPath, content, 'utf-8');
      return { success: true };
    } catch (err: unknown) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  };
}

function readFileExecutor(safePath: ReturnType<typeof createSafePath>) {
  return async (args: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const path = args['path'] as string | undefined;
    if (!path) return { error: 'Missing required argument: path' };
    const fullPath = await safePath(path);
    if (!fullPath) return { error: 'Path traversal not allowed' };
    try {
      const content = await fsReadFile(fullPath, 'utf-8');
      return { content };
    } catch (err: unknown) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  };
}

function listFilesExecutor(safePath: ReturnType<typeof createSafePath>) {
  return async (args: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const path = args['path'] as string | undefined;
    if (!path) return { error: 'Missing required argument: path' };
    const fullPath = await safePath(path);
    if (!fullPath) return { error: 'Path traversal not allowed' };
    try {
      const files = await readdir(fullPath);
      return { files };
    } catch (err: unknown) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  };
}

const writeFileDef: ToolDefinition = {
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
};

const readFileDef: ToolDefinition = {
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
};

const listFilesDef: ToolDefinition = {
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
};

export function createFileTools(workspace: string): ToolSet {
  const safePath = createSafePath(workspace);
  return {
    definitions: [writeFileDef, readFileDef, listFilesDef],
    executors: {
      writeFile: writeFileExecutor(safePath),
      readFile: readFileExecutor(safePath),
      listFiles: listFilesExecutor(safePath),
    },
  };
}

export function createReadWriteTools(workspace: string): ToolSet {
  const safePath = createSafePath(workspace);
  return {
    definitions: [readFileDef, writeFileDef],
    executors: {
      readFile: readFileExecutor(safePath),
      writeFile: writeFileExecutor(safePath),
    },
  };
}

export function createReadTools(workspace: string): ToolSet {
  const safePath = createSafePath(workspace);
  return {
    definitions: [readFileDef, listFilesDef],
    executors: {
      readFile: readFileExecutor(safePath),
      listFiles: listFilesExecutor(safePath),
    },
  };
}
