import {EventEmitter} from 'node:events';

// JSON-RPC 2.0 over a child's stdin and stdout, one message a line, as the
// Agent Client Protocol speaks it. Requests from the agent to the client get
// an answer from the handler, or an error when there is none: silence would
// leave the agent waiting.

export class AcpClient extends EventEmitter {
  /**
   * @param {{stdin: NodeJS.WritableStream, stdout: NodeJS.ReadableStream}} streams
   * @param {(method: string, params: object) => Promise<any>} [onRequest] answers the agent's requests
   */
  constructor({stdin, stdout}, onRequest = null) {
    super();
    this.stdin = stdin;
    this.onRequest = onRequest;
    this.nextId = 0;
    this.pending = new Map();
    this.buffer = '';
    this.closed = false;
    stdout.setEncoding?.('utf8');
    stdout.on('data', (chunk) => this.read(chunk));
  }

  read(chunk) {
    this.buffer += chunk;
    let end;
    while ((end = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, end).trim();
      this.buffer = this.buffer.slice(end + 1);
      if (!line) {
        continue;
      }
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        // not ours: a stray line of the agent's own output
        continue;
      }
      this.dispatch(message);
    }
  }

  dispatch(message) {
    if (message.id !== undefined && !message.method) {
      const waiting = this.pending.get(message.id);
      if (waiting) {
        this.pending.delete(message.id);
        if (message.error) {
          const error = new Error(message.error.message ?? 'ACP error');
          error.code = message.error.code;
          error.data = message.error.data;
          waiting.reject(error);
        } else {
          waiting.resolve(message.result);
        }
      }
      return;
    }
    if (message.method && message.id !== undefined) {
      this.answer(message);
      return;
    }
    if (message.method) {
      this.emit('notification', message.method, message.params ?? {});
    }
  }

  async answer({id, method, params}) {
    try {
      if (!this.onRequest) {
        throw Object.assign(new Error(`Not supported: ${method}`), {code: -32601});
      }
      const result = await this.onRequest(method, params ?? {});
      this.write({jsonrpc: '2.0', id, result: result ?? null});
    } catch (error) {
      this.write({jsonrpc: '2.0', id, error: {code: error.code ?? -32603, message: error.message ?? 'Error'}});
    }
  }

  write(message) {
    if (!this.closed) {
      this.stdin.write(`${JSON.stringify(message)}\n`);
    }
  }

  /** Sends a request and waits for its answer. */
  request(method, params = {}) {
    if (this.closed) {
      return Promise.reject(new Error('The agent is not running'));
    }
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, {resolve, reject});
      this.write({jsonrpc: '2.0', id, method, params});
    });
  }

  notify(method, params = {}) {
    this.write({jsonrpc: '2.0', method, params});
  }

  /** The process is gone: every waiting request fails at once. */
  close(reason = 'The agent stopped') {
    this.closed = true;
    for (const waiting of this.pending.values()) {
      waiting.reject(new Error(reason));
    }
    this.pending.clear();
  }
}
