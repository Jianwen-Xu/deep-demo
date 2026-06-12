export const ALLOWED_COMMANDS = [
  'npm', 'npx', 'node', 'tsx',
  'vitest', 'tsc',
  'echo', 'cat', 'ls', 'mkdir', 'cp', 'mv',
  'pwd', 'head', 'tail', 'wc', 'sort', 'uniq',
  'which', 'test', '[',
];

export function validateCommand(command: string): { valid: boolean; reason?: string } {
  const trimmed = command.trim();
  if (!trimmed) {
    return { valid: false, reason: 'Empty command' };
  }

  const firstToken = trimmed.split(/\s+/)[0];
  if (!ALLOWED_COMMANDS.includes(firstToken)) {
    return { valid: false, reason: `Command '${firstToken}' is not in the allowed list` };
  }

  const BLOCKED_PATTERNS = [
    /;\s*(rm|rmdir|dd|mkfs|:\(\)|wget|curl|chmod|chown)/i,
    /&&/,
    /\|\|/,
    /(?<!\|)\|(?!\|)/,
    /`[^`]+`/,
    /\$\(/,
    />\s*\/dev\//,
    /\/dev\/(null|zero|random|urandom)/,
  ];

  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { valid: false, reason: `Command matches blocked pattern: ${pattern}` };
    }
  }

  return { valid: true };
}
