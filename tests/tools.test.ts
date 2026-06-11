import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFileTools } from '../src/tools.js';

describe('createFileTools', () => {
  let workspace: string;

  beforeAll(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'tools-test-'));
  });

  afterAll(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  beforeEach(async () => {
    const entries = (await import('node:fs/promises')).readdir(workspace);
    for (const entry of await entries) {
      await rm(join(workspace, entry), { recursive: true, force: true });
    }
  });

  describe('readFile', () => {
    it('reads file content', async () => {
      const testFile = join(workspace, 'test.txt');
      await writeFile(testFile, 'hello world');

      const tools = createFileTools(workspace);
      const result = await tools.readFile.execute!({ path: 'test.txt' });

      expect(result).toEqual({ content: 'hello world' });
    });

    it('returns error for non-existent file', async () => {
      const tools = createFileTools(workspace);
      const result = await tools.readFile.execute!({ path: 'missing.txt' });

      expect(result).toHaveProperty('error');
    });

    it('rejects path traversal', async () => {
      const tools = createFileTools(workspace);
      const result = await tools.readFile.execute!({ path: '../etc/passwd' });

      expect(result).toHaveProperty('error');
    });
  });

  describe('writeFile', () => {
    it('writes file content', async () => {
      const tools = createFileTools(workspace);
      const result = await tools.writeFile.execute!({
        path: 'output.txt',
        content: 'new content',
      });

      expect(result).toEqual({ success: true });
      const content = await readFile(join(workspace, 'output.txt'), 'utf-8');
      expect(content).toBe('new content');
    });

    it('creates intermediate directories', async () => {
      const tools = createFileTools(workspace);
      const result = await tools.writeFile.execute!({
        path: 'sub/dir/file.txt',
        content: 'nested',
      });

      expect(result).toEqual({ success: true });
      const content = await readFile(join(workspace, 'sub/dir/file.txt'), 'utf-8');
      expect(content).toBe('nested');
    });

    it('rejects path traversal', async () => {
      const tools = createFileTools(workspace);
      const result = await tools.writeFile.execute!({
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
      const result = await tools.listFiles.execute!({ path: '.' });

      expect(result).toHaveProperty('files');
      expect(result.files).toContain('a.txt');
      expect(result.files).toContain('b.txt');
      expect(result.files).toContain('subdir');
    });

    it('lists files in subdirectory', async () => {
      await mkdir(join(workspace, 'src'), { recursive: true });
      await writeFile(join(workspace, 'src/index.ts'), 'code');

      const tools = createFileTools(workspace);
      const result = await tools.listFiles.execute!({ path: 'src' });

      expect(result.files).toContain('index.ts');
    });

    it('returns error for non-existent directory', async () => {
      const tools = createFileTools(workspace);
      const result = await tools.listFiles.execute!({ path: 'nope' });

      expect(result).toHaveProperty('error');
    });

    it('rejects path traversal', async () => {
      const tools = createFileTools(workspace);
      const result = await tools.listFiles.execute!({ path: '..' });

      expect(result).toHaveProperty('error');
    });
  });

  describe('executeCommand', () => {
    it('executes shell command and returns output', async () => {
      const tools = createFileTools(workspace);
      const result = await tools.executeCommand.execute!({ command: 'echo hello' });

      expect(result).toHaveProperty('stdout');
      expect(result.stdout).toContain('hello');
      expect(result).toHaveProperty('exitCode');
      expect(result.exitCode).toBe(0);
    });

    it('captures stderr on error', async () => {
      const tools = createFileTools(workspace);
      const result = await tools.executeCommand.execute!({
        command: 'echo errormsg >&2 && exit 1',
      });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('errormsg');
    });
  });

  describe('tool structure', () => {
    it('all tools have required AI SDK fields', () => {
      const tools = createFileTools(workspace);

      for (const name of ['readFile', 'writeFile', 'listFiles', 'executeCommand']) {
        expect(tools[name]).toBeDefined();
        expect(tools[name].description).toBeDefined();
        expect(tools[name].inputSchema).toBeDefined();
        expect(tools[name].execute).toBeTypeOf('function');
      }
    });
  });
});
