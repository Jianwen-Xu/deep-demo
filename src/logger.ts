export class Logger {
  private startTime: Map<string, number> = new Map();

  log(agent: string, message: string) {
    const timestamp = new Date().toISOString().slice(11, 23);
    console.log(`[${timestamp}] [${agent.padEnd(12)}] ${message}`);
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
      this.log(agent, `${action} done (no start time recorded)`);
      return;
    }
    const duration = Date.now() - start;
    this.log(agent, `${action} done (${duration}ms)`);
    this.startTime.delete(key);
  }
}
