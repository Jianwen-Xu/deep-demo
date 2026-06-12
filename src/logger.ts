export class Logger {
  private startTime: Map<string, number> = new Map();

  private ts(): string {
    return new Date().toISOString().slice(11, 23);
  }

  private pad(): string {
    return ' '.repeat(14);
  }

  log(agent: string, message: string) {
    console.log(`[${this.ts()}] [${agent.padEnd(12)}] ${message}`);
  }

  sub(agent: string, message: string) {
    console.log(`[${this.ts()}] [${agent.padEnd(12)}]   ${message}`);
  }

  detail(agent: string, message: string) {
    console.log(`[${this.ts()}] [${agent.padEnd(12)}]     ${message}`);
  }

  start(agent: string, action: string) {
    const key = `${agent}:${action}`;
    this.startTime.set(key, Date.now());
    this.log(agent, `${action}...`);
  }

  end(agent: string, action: string) {
    const key = `${agent}:${action}`;
    const start = this.startTime.get(key);
    if (start === undefined) {
      this.log(agent, `${action} done`);
      return;
    }
    const duration = Date.now() - start;
    this.log(agent, `${action} done (${duration}ms)`);
    this.startTime.delete(key);
  }
}
