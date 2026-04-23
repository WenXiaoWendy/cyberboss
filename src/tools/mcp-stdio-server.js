const fs = require("fs");
function runToolMcpServer({ toolHost, runtimeId = "", workspaceRoot = "" }) {
  const reader = createMessageReader(process.stdin);
  const toolCatalog = toolHost.listTools();
  const resources = buildToolResources(toolCatalog);

  reader.onMessage(async (message) => {
    if (!message || typeof message !== "object") {
      return;
    }
    const id = message.id;
    const method = typeof message.method === "string" ? message.method : "";
    const params = message.params || {};

    try {
      if (method === "initialize") {
        writeRpcResponse(id, {
          protocolVersion: params.protocolVersion || "2024-11-05",
          capabilities: {
            tools: {
              listChanged: false,
            },
            prompts: {
              listChanged: false,
            },
            resources: {
              listChanged: false,
            },
          },
          serverInfo: {
            name: "cyberboss-tools",
            version: "0.1.0",
          },
        }, reader.getMode());
        return;
      }

      if (method === "notifications/initialized") {
        return;
      }

      if (method === "ping") {
        writeRpcResponse(id, {}, reader.getMode());
        return;
      }

      if (method === "tools/list") {
        writeRpcResponse(id, {
          tools: toolHost.listTools(),
        }, reader.getMode());
        return;
      }

      if (method === "resources/list") {
        writeRpcResponse(id, {
          resources: resources.map((resource) => ({
            uri: resource.uri,
            name: resource.name,
            description: resource.description,
            mimeType: resource.mimeType,
          })),
        }, reader.getMode());
        return;
      }

      if (method === "resources/read") {
        const uri = typeof params.uri === "string" ? params.uri.trim() : "";
        const resource = resources.find((entry) => entry.uri === uri);
        if (!resource) {
          writeRpcError(id, -32602, `Unknown resource: ${uri}`, reader.getMode());
          return;
        }
        writeRpcResponse(id, {
          contents: [
            {
              uri: resource.uri,
              mimeType: resource.mimeType,
              text: resource.text,
            },
          ],
        }, reader.getMode());
        return;
      }

      if (method === "prompts/list") {
        writeRpcResponse(id, {
          prompts: [],
        }, reader.getMode());
        return;
      }

      if (method === "tools/call") {
        const toolName = typeof params.name === "string" ? params.name : "";
        const args = params.arguments && typeof params.arguments === "object"
          ? params.arguments
          : {};
        const result = await toolHost.invokeTool(toolName, args, {
          runtimeId,
          workspaceRoot,
        });
        writeRpcResponse(id, {
          content: [
            {
              type: "text",
              text: formatToolResult(result),
            },
          ],
        }, reader.getMode());
        return;
      }

      writeRpcError(id, -32601, `Method not found: ${method}`, reader.getMode());
    } catch (error) {
      writeRpcResponse(id, {
        content: [
          {
            type: "text",
            text: error instanceof Error ? error.message : String(error || "unknown error"),
          },
        ],
        isError: true,
      }, reader.getMode());
    }
  });
}

function formatToolResult(result) {
  if (!result || typeof result !== "object") {
    return String(result || "");
  }
  if (result.text && result.data) {
    return `${result.text}\n${JSON.stringify(result.data, null, 2)}`;
  }
  if (result.text) {
    return String(result.text);
  }
  return JSON.stringify(result, null, 2);
}

function buildToolResources(toolCatalog) {
  const tools = Array.isArray(toolCatalog) ? toolCatalog : [];
  const resources = [];
  resources.push({
    uri: "cyberboss://tools/index",
    name: "Cyberboss Tool Index",
    description: "Overview of Cyberboss project tools with schemas and usage notes.",
    mimeType: "text/markdown",
    text: buildToolIndexMarkdown(tools),
  });
  for (const tool of tools) {
    resources.push({
      uri: `cyberboss://tools/${tool.name}`,
      name: `${tool.name} schema`,
      description: `Detailed schema and usage guidance for ${tool.name}.`,
      mimeType: "text/markdown",
      text: buildToolMarkdown(tool),
    });
  }
  return resources;
}

function buildToolIndexMarkdown(tools) {
  const lines = [
    "# Cyberboss Project Tools",
    "",
    "These are Cyberboss project tools.",
    "",
  ];
  for (const tool of tools) {
    lines.push(`## ${tool.name}`);
    lines.push("");
    lines.push(tool.description || "");
    lines.push("");
    lines.push("Schema:");
    lines.push("```json");
    lines.push(JSON.stringify(tool.inputSchema || {}, null, 2));
    lines.push("```");
    lines.push("");
  }
  return lines.join("\n").trim() + "\n";
}

function buildToolMarkdown(tool) {
  const lines = [
    `# ${tool.name}`,
    "",
    tool.description || "",
    "",
    "Input schema:",
    "```json",
    JSON.stringify(tool.inputSchema || {}, null, 2),
    "```",
    "",
  ];
  return lines.join("\n");
}

function createMessageReader(stream) {
  let buffer = Buffer.alloc(0);
  const listeners = new Set();
  let mode = "content-length";

  stream.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
    while (true) {
      const headerEnd = findHeaderBoundary(buffer);
      if (headerEnd >= 0) {
        mode = "content-length";
        const separatorLength = buffer[headerEnd] === 13 ? 4 : 2;
        const headerText = buffer.slice(0, headerEnd).toString("utf8");
        const lengthMatch = headerText.match(/Content-Length:\s*(\d+)/i);
        if (!lengthMatch) {
          buffer = Buffer.alloc(0);
          return;
        }
        const contentLength = Number.parseInt(lengthMatch[1], 10);
        const bodyStart = headerEnd + separatorLength;
        if (buffer.length < bodyStart + contentLength) {
          return;
        }
        const body = buffer.slice(bodyStart, bodyStart + contentLength).toString("utf8");
        buffer = buffer.slice(bodyStart + contentLength);
        emitParsedMessage(body, listeners);
        continue;
      }

      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex < 0) {
        return;
      }
      const line = buffer.slice(0, newlineIndex).toString("utf8").trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (!line) {
        continue;
      }
      mode = "jsonl";
      emitParsedMessage(line, listeners);
    }
  });

  return {
    onMessage(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getMode() {
      return mode;
    },
  };
}

function emitParsedMessage(body, listeners) {
  let parsed = null;
  try {
    parsed = JSON.parse(body);
  } catch {
    return;
  }
  for (const listener of listeners) {
    listener(parsed);
  }
}

function findHeaderBoundary(buffer) {
  const crlf = buffer.indexOf("\r\n\r\n");
  if (crlf >= 0) {
    return crlf;
  }
  return buffer.indexOf("\n\n");
}

function writeRpcResponse(id, result, mode = "content-length") {
  writeMessage({
    jsonrpc: "2.0",
    id,
    result,
  }, mode);
}

function writeRpcError(id, code, message, mode = "content-length") {
  writeMessage({
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
    },
  }, mode);
}

function writeMessage(payload, mode = "content-length") {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  if (mode === "jsonl") {
    fs.writeSync(process.stdout.fd, Buffer.concat([body, Buffer.from("\n", "utf8")]));
    return;
  }
  const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "utf8");
  fs.writeSync(process.stdout.fd, Buffer.concat([header, body]));
}

module.exports = { runToolMcpServer };
