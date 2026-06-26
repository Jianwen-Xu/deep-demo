import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFileTools, createReadWriteTools, createReadTools } from '../src/tools.js';

describe('createFileTools', () => {
  let workspace: string;

  beforeAll(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'tools-test-'));
  });

  afterAll(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  beforeEach(async () => {
    const dirs = await readdirSafe(workspace);
    for (const entry of dirs) {
      await rm(join(workspace, entry), { recursive: true, force: true });
    }
  });

  const readdirSafe = async (dir: string) => {
    try {
      return await readdir(dir);
    } catch {
      return [];
    }
  };

  const readdir = async (dir: string) => {
    const { readdir: rd } = await import('node:fs/promises');
    return rd(dir);
  };

  describe('readFile', () => {
    it('reads file content', async () => {
      const testFile = join(workspace, 'test.txt');
      await writeFile(testFile, 'hello world');

      const tools = createFileTools(workspace);
      const result = await tools.executors.readFile({ path: 'test.txt' });

      expect(result).toEqual({ content: 'hello world' });
    });

    it('returns error for non-existent file', async () => {
      const tools = createFileTools(workspace);
      const result = await tools.executors.readFile({ path: 'missing.txt' });

      expect(result).toHaveProperty('error');
    });

    it('rejects path traversal', async () => {
      const tools = createFileTools(workspace);
      const result = await tools.executors.readFile({ path: '../etc/passwd' });

      expect(result).toHaveProperty('error');
    });
  });

  describe('writeFile', () => {
    it('writes file content', async () => {
      const tools = createFileTools(workspace);
      const result = await tools.executors.writeFile({
        path: 'output.txt',
        content: 'new content',
      });

      expect(result).toEqual({ success: true });
      const content = await readFile(join(workspace, 'output.txt'), 'utf-8');
      expect(content).toBe('new content');
    });

    it('creates intermediate directories', async () => {
      const tools = createFileTools(workspace);
      const result = await tools.executors.writeFile({
        path: 'sub/dir/file.txt',
        content: 'nested',
      });

      expect(result).toEqual({ success: true });
      const content = await readFile(join(workspace, 'sub/dir/file.txt'), 'utf-8');
      expect(content).toBe('nested');
    });

    it('rejects path traversal', async () => {
      const tools = createFileTools(workspace);
      const result = await tools.executors.writeFile({
        path: '../evil.txt',
        content: 'bad',
      });

      expect(result).toHaveProperty('error');
    });
  });

  describe('listFiles', () => {
    it('lists files in directory', async () => {
      await writeFile(join(workspace, 'a.txt'), 'a');
      await writeFile(join(workspace, 'b.txt'), 'b');
      await mkdir(join(workspace, 'subdir'), { recursive: true });

      const tools = createFileTools(workspace);
      const result = await tools.executors.listFiles({ path: '.' });

      expect(result).toHaveProperty('files');
      expect(result.files).toContain('a.txt');
      expect(result.files).toContain('b.txt');
      expect(result.files).toContain('subdir');
    });

    it('lists files in subdirectory', async () => {
      await mkdir(join(workspace, 'src'), { recursive: true });
      await writeFile(join(workspace, 'src/index.ts'), 'code');

      const tools = createFileTools(workspace);
      const result = await tools.executors.listFiles({ path: 'src' });

      expect(result.files).toContain('index.ts');
    });

    it('returns error for non-existent directory', async () => {
      const tools = createFileTools(workspace);
      const result = await tools.executors.listFiles({ path: 'nope' });

      expect(result).toHaveProperty('error');
    });

    it('rejects path traversal', async () => {
      const tools = createFileTools(workspace);
      const result = await tools.executors.listFiles({ path: '..' });

      expect(result).toHaveProperty('error');
    });
  });

  describe('tool definitions', () => {
    it('all tools have required definitions fields', () => {
      const tools = createFileTools(workspace);

      const names = tools.definitions.map((d: any) => d.function.name);
      expect(names).toContain('readFile');
      expect(names).toContain('writeFile');
      expect(names).toContain('listFiles');

      for (const def of tools.definitions) {
        expect(def.type).toBe('function');
        expect(def.function.description).toBeDefined();
        expect(def.function.parameters).toBeDefined();
      }
    });
  });
});

describe('createReadWriteTools', () => {
  let workspace: string;

  beforeAll(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'rw-test-'));
  });

  afterAll(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  it('provides readFile and writeFile but not listFiles', () => {
    const tools = createReadWriteTools(workspace);
    const names = tools.definitions.map((d: any) => d.function.name);
    expect(names).toContain('readFile');
    expect(names).toContain('writeFile');
    expect(names).not.toContain('listFiles');
  });

  it('readFile works', async () => {
    await writeFile(join(workspace, 'test.txt'), 'hello');
    const tools = createReadWriteTools(workspace);
    const result = await tools.executors.readFile({ path: 'test.txt' });
    expect(result).toEqual({ content: 'hello' });
  });

  it('writeFile works', async () => {
    const tools = createReadWriteTools(workspace);
    await tools.executors.writeFile({ path: 'out.txt', content: 'data' });
    const content = await readFile(join(workspace, 'out.txt'), 'utf-8');
    expect(content).toBe('data');
  });
});

describe('createReadTools', () => {
  let workspace: string;

  beforeAll(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'read-test-'));
  });

  afterAll(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  it('provides readFile and listFiles but not writeFile', () => {
    const tools = createReadTools(workspace);
    const names = tools.definitions.map((d: any) => d.function.name);
    expect(names).toContain('readFile');
    expect(names).toContain('listFiles');
    expect(names).not.toContain('writeFile');
  });
});
