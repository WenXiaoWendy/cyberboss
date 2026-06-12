const net = require("net");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { EventEmitter } = require("events");

class ClaudeCodeIpcServer extends EventEmitter {
  constructor({ socketPath }) {
    super();
    this.socketPath = socketPath;
    this.tokenFile = `${socketPath}.token`;
    this.authToken = "";
    this.server = null;
    this.clients = new Set();
    this.authenticated = new Set();
  }

  start() {
    if (this.server) return;
    this.ensureDirectory();
    this.removeStaleSocket();
    this.generateAuthToken();

    this.server = net.createServer((socket) => {
      this.clients.add(socket);
      socket.setEncoding("utf8");

      let buffer = "";
      socket.on("data", (chunk) => {
        buffer += chunk;
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);
            if (!this.authenticated.has(socket)) {
              if (msg?.type === "auth" && msg?.token === this.authToken) {
                this.authenticated.add(socket);
              }
              continue;
            }
            if (validateIpcMessage(msg)) {
              this.emit("clientMessage", msg, socket);
            }
          } catch {
            // ignore malformed
          }
        }
      });

      socket.on("close", () => {
        this.clients.delete(socket);
        this.authenticated.delete(socket);
      });

      socket.on("error", () => {
        this.clients.delete(socket);
        this.authenticated.delete(socket);
      });
    });

    const listenPath = resolveListenPath(this.socketPath);
    this.server.on("error", (err) => {
      console.error(`[cyberboss] IPC server listen failed: ${err.message}`);
    });
    this.server.listen(listenPath, () => {
      if (process.platform !== "win32") {
        try { fs.chmodSync(this.socketPath, 0o600); } catch { /* ignore */ }
      }
    });
  }

  broadcast(event) {
    const payload = JSON.stringify(event) + "\n";
    for (const client of this.authenticated) {
      try {
        client.write(payload);
      } catch {
        // ignore dead sockets
      }
    }
  }

  ensureDirectory() {
    const dir = path.dirname(this.socketPath);
    fs.mkdirSync(dir, { recursive: true });
  }

  removeStaleSocket() {
    try {
      const stat = fs.lstatSync(this.socketPath);
      if (!stat.isSocket()) {
        return;
      }
      fs.unlinkSync(this.socketPath);
    } catch {
      // ignore
    }
  }

  generateAuthToken() {
    this.authToken = crypto.randomBytes(32).toString("hex");
    try {
      fs.writeFileSync(this.tokenFile, this.authToken, { mode: 0o600 });
    } catch {
      // ignore
    }
  }

  removeAuthToken() {
    try {
      fs.unlinkSync(this.tokenFile);
    } catch {
      // ignore
    }
  }

  async close() {
    for (const client of this.clients) {
      try {
        client.end();
      } catch {
        // ignore
      }
    }
    this.clients.clear();
    this.authenticated.clear();

    if (this.server) {
      await new Promise((resolve) => {
        this.server.close(resolve);
      });
      this.server = null;
    }

    this.removeStaleSocket();
    this.removeAuthToken();
  }
}

function validateIpcMessage(msg) {
  if (!msg || typeof msg !== "object" || Array.isArray(msg)) {
    return false;
  }
  const type = msg.type;
  if (typeof type !== "string") {
    return false;
  }
  switch (type) {
    case "sendUserMessage":
      return typeof msg.workspaceRoot === "string" && typeof msg.text === "string";
    case "respondApproval":
      return typeof msg.workspaceRoot === "string" && typeof msg.requestId === "string";
    default:
      return true;
  }
}

module.exports = { ClaudeCodeIpcServer };

function resolveListenPath(socketPath) {
  if (process.platform === "win32") {
    const name = path.basename(socketPath).replace(/\.sock$/i, "");
    return `\\\\.\\pipe\\${name}`;
  }
  return socketPath;
}
