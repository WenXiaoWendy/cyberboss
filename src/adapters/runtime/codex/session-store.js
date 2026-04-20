const fs = require("fs");
const path = require("path");
const { normalizeModelCatalog } = require("./model-catalog");
const { normalizeCommandTokens } = require("../shared/approval-command");

class SessionStore {
  constructor({ filePath, runtimeId = "" }) {
    this.filePath = filePath;
    this.runtimeId = normalizeValue(runtimeId);
    this.state = createEmptyState();
    this.ensureParentDirectory();
    this.load();
  }

  ensureParentDirectory() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
  }

  load() {
    try {
      const raw = fs.readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && parsed.bindings) {
        this.state = {
          ...createEmptyState(),
          ...parsed,
          bindings: parsed.bindings || {},
          approvalCommandAllowlistByWorkspaceRoot: parsed.approvalCommandAllowlistByWorkspaceRoot || {},
          approvalPromptStateByThreadId: parsed.approvalPromptStateByThreadId || {},
          availableModelCatalog: parsed.availableModelCatalog || {
            models: [],
            updatedAt: "",
          },
        };
      }
    } catch {
      this.state = createEmptyState();
    }
  }

  save() {
    fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2));
  }

  getBinding(bindingKey) {
    return this.state.bindings[bindingKey] || null;
  }

  listBindings() {
    return Object.entries(this.state.bindings || {}).map(([bindingKey, binding]) => ({
      bindingKey,
      ...(binding || {}),
    }));
  }

  getActiveWorkspaceRoot(bindingKey) {
    return normalizeValue(this.state.bindings[bindingKey]?.activeWorkspaceRoot);
  }

  updateBinding(bindingKey, nextBinding) {
    this.state.bindings[bindingKey] = {
      ...(this.state.bindings[bindingKey] || {}),
      ...(nextBinding || {}),
    };
    this.save();
    return this.state.bindings[bindingKey];
  }

  getThreadIdForWorkspace(bindingKey, workspaceRoot, runtimeId = this.runtimeId) {
    const normalizedWorkspaceRoot = normalizeValue(workspaceRoot);
    if (!normalizedWorkspaceRoot) {
      return "";
    }
    const binding = this.getBinding(bindingKey) || {};
    const scoped = getThreadMapForRuntime(binding, runtimeId);
    if (scoped[normalizedWorkspaceRoot]) {
      return scoped[normalizedWorkspaceRoot];
    }
    return "";
  }

  setThreadIdForWorkspace(bindingKey, workspaceRoot, threadId, extra = {}, runtimeId = this.runtimeId) {
    const normalizedWorkspaceRoot = normalizeValue(workspaceRoot);
    if (!normalizedWorkspaceRoot) {
      return this.getBinding(bindingKey);
    }

    const current = this.getBinding(bindingKey) || {};
    const normalizedRuntimeId = normalizeValue(runtimeId);
    const normalizedThreadId = normalizeThreadValue(threadId);
    const threadIdByWorkspaceRootByRuntime = {
      ...getThreadRuntimeMap(current),
      [normalizedRuntimeId || "default"]: {
        ...getThreadMapForRuntime(current, normalizedRuntimeId),
        [normalizedWorkspaceRoot]: normalizedThreadId,
      },
    };
    const nextBinding = {
      ...current,
      ...extra,
      activeWorkspaceRoot: normalizedWorkspaceRoot,
      threadIdByWorkspaceRootByRuntime,
    };

    if (normalizedRuntimeId === "codex") {
      nextBinding.threadIdByWorkspaceRoot = {
        ...getLegacyThreadMap(current),
        [normalizedWorkspaceRoot]: normalizedThreadId,
      };
    }

    return this.updateBinding(bindingKey, nextBinding);
  }

  getRuntimeParamsForWorkspace(bindingKey, workspaceRoot) {
    const normalizedWorkspaceRoot = normalizeValue(workspaceRoot);
    if (!normalizedWorkspaceRoot) {
      return { model: "" };
    }
    const current = this.getBinding(bindingKey) || {};
    const codexParamsByWorkspaceRoot = getCodexParamsMap(current);
    const entry = codexParamsByWorkspaceRoot[normalizedWorkspaceRoot];
    return {
      model: normalizeValue(entry?.model),
    };
  }

  setRuntimeParamsForWorkspace(bindingKey, workspaceRoot, { model = "" }) {
    const normalizedWorkspaceRoot = normalizeValue(workspaceRoot);
    if (!normalizedWorkspaceRoot) {
      return this.getBinding(bindingKey);
    }
    const current = this.getBinding(bindingKey) || {};
    const codexParamsByWorkspaceRoot = {
      ...getCodexParamsMap(current),
      [normalizedWorkspaceRoot]: {
        model: normalizeValue(model),
      },
    };
    return this.updateBinding(bindingKey, {
      ...current,
      codexParamsByWorkspaceRoot,
    });
  }

  clearThreadIdForWorkspace(bindingKey, workspaceRoot, runtimeId = this.runtimeId) {
    const normalizedWorkspaceRoot = normalizeValue(workspaceRoot);
    if (!normalizedWorkspaceRoot) {
      return this.getBinding(bindingKey);
    }
    const current = this.getBinding(bindingKey) || {};
    const normalizedRuntimeId = normalizeValue(runtimeId);
    const threadIdByWorkspaceRootByRuntime = {
      ...getThreadRuntimeMap(current),
      [normalizedRuntimeId || "default"]: {
        ...getThreadMapForRuntime(current, normalizedRuntimeId),
        [normalizedWorkspaceRoot]: "",
      },
    };
    const nextBinding = {
      ...current,
      threadIdByWorkspaceRootByRuntime,
    };
    if (normalizedRuntimeId === "codex") {
      nextBinding.threadIdByWorkspaceRoot = {
        ...getLegacyThreadMap(current),
        [normalizedWorkspaceRoot]: "",
      };
    }
    return this.updateBinding(bindingKey, nextBinding);
  }

  getPendingThreadIdForWorkspace(bindingKey, workspaceRoot, runtimeId = this.runtimeId) {
    const normalizedWorkspaceRoot = normalizeValue(workspaceRoot);
    if (!normalizedWorkspaceRoot) {
      return "";
    }
    const binding = this.getBinding(bindingKey) || {};
    return getPendingThreadMapForRuntime(binding, runtimeId)[normalizedWorkspaceRoot] || "";
  }

  setPendingThreadIdForWorkspace(bindingKey, workspaceRoot, threadId, runtimeId = this.runtimeId) {
    const normalizedWorkspaceRoot = normalizeValue(workspaceRoot);
    if (!normalizedWorkspaceRoot) {
      return this.getBinding(bindingKey);
    }
    const current = this.getBinding(bindingKey) || {};
    const normalizedRuntimeId = normalizeValue(runtimeId);
    const normalizedThreadId = normalizeThreadValue(threadId);
    const pendingThreadIdByWorkspaceRootByRuntime = {
      ...getPendingThreadRuntimeMap(current),
      [normalizedRuntimeId || "default"]: {
        ...getPendingThreadMapForRuntime(current, normalizedRuntimeId),
        [normalizedWorkspaceRoot]: normalizedThreadId,
      },
    };
    return this.updateBinding(bindingKey, {
      ...current,
      pendingThreadIdByWorkspaceRootByRuntime,
    });
  }

  clearPendingThreadIdForWorkspace(bindingKey, workspaceRoot, runtimeId = this.runtimeId) {
    const normalizedWorkspaceRoot = normalizeValue(workspaceRoot);
    if (!normalizedWorkspaceRoot) {
      return this.getBinding(bindingKey);
    }
    const current = this.getBinding(bindingKey) || {};
    const normalizedRuntimeId = normalizeValue(runtimeId);
    const pendingThreadIdByWorkspaceRootByRuntime = {
      ...getPendingThreadRuntimeMap(current),
      [normalizedRuntimeId || "default"]: {
        ...getPendingThreadMapForRuntime(current, normalizedRuntimeId),
        [normalizedWorkspaceRoot]: "",
      },
    };
    return this.updateBinding(bindingKey, {
      ...current,
      pendingThreadIdByWorkspaceRootByRuntime,
    });
  }

  setActiveWorkspaceRoot(bindingKey, workspaceRoot) {
    const normalizedWorkspaceRoot = normalizeValue(workspaceRoot);
    if (!normalizedWorkspaceRoot) {
      return this.getBinding(bindingKey);
    }
    return this.updateBinding(bindingKey, {
      activeWorkspaceRoot: normalizedWorkspaceRoot,
    });
  }

  listWorkspaceRoots(bindingKey, runtimeId = this.runtimeId) {
    const current = this.getBinding(bindingKey) || {};
    return Object.keys(getThreadMapForRuntime(current, runtimeId));
  }

  findBindingForThreadId(threadId, runtimeId = this.runtimeId) {
    const normalizedThreadId = normalizeValue(threadId);
    if (!normalizedThreadId) {
      return null;
    }
    const normalizedRuntimeId = normalizeValue(runtimeId);
    for (const [bindingKey, binding] of Object.entries(this.state.bindings || {})) {
      for (const [workspaceRoot, candidateThreadId] of Object.entries(getThreadMapForRuntime(binding, normalizedRuntimeId))) {
        if (normalizeValue(candidateThreadId) === normalizedThreadId) {
          return {
            bindingKey,
            workspaceRoot: normalizeValue(workspaceRoot),
          };
        }
      }
    }
    return null;
  }

  getApprovalCommandAllowlistForWorkspace(workspaceRoot) {
    const normalizedWorkspaceRoot = normalizeValue(workspaceRoot);
    if (!normalizedWorkspaceRoot) {
      return [];
    }
    const raw = this.state.approvalCommandAllowlistByWorkspaceRoot?.[normalizedWorkspaceRoot];
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw
      .filter((entry) => Array.isArray(entry))
      .map((entry) => entry.map((part) => normalizeValue(part)).filter(Boolean))
      .filter((entry) => entry.length);
  }

  rememberApprovalPrefixForWorkspace(workspaceRoot, commandTokens) {
    const normalizedWorkspaceRoot = normalizeValue(workspaceRoot);
    const normalizedTokens = normalizeCommandTokens(commandTokens);
    if (!normalizedWorkspaceRoot || !normalizedTokens.length) {
      return this.getApprovalCommandAllowlistForWorkspace(workspaceRoot);
    }
    const current = this.getApprovalCommandAllowlistForWorkspace(normalizedWorkspaceRoot);
    if (!current.some((entry) => isSameTokenList(entry, normalizedTokens))) {
      current.push(normalizedTokens);
      this.state.approvalCommandAllowlistByWorkspaceRoot = {
        ...(this.state.approvalCommandAllowlistByWorkspaceRoot || {}),
        [normalizedWorkspaceRoot]: current,
      };
      this.save();
    }
    return current;
  }

  getApprovalPromptState(threadId) {
    const normalizedThreadId = normalizeValue(threadId);
    if (!normalizedThreadId) {
      return null;
    }
    const raw = this.state.approvalPromptStateByThreadId?.[normalizedThreadId];
    if (!raw || typeof raw !== "object") {
      return null;
    }
    return {
      requestId: normalizeValue(raw.requestId),
      signature: normalizeValue(raw.signature),
      promptedAt: normalizeValue(raw.promptedAt),
    };
  }

  rememberApprovalPrompt(threadId, requestId, signature = "") {
    const normalizedThreadId = normalizeValue(threadId);
    const normalizedRequestId = normalizeValue(requestId);
    const normalizedSignature = normalizeValue(signature);
    if (!normalizedThreadId || !normalizedRequestId) {
      return null;
    }
    this.state.approvalPromptStateByThreadId = {
      ...(this.state.approvalPromptStateByThreadId || {}),
      [normalizedThreadId]: {
        requestId: normalizedRequestId,
        signature: normalizedSignature,
        promptedAt: new Date().toISOString(),
      },
    };
    this.save();
    return this.getApprovalPromptState(normalizedThreadId);
  }

  clearApprovalPrompt(threadId) {
    const normalizedThreadId = normalizeValue(threadId);
    if (!normalizedThreadId || !this.state.approvalPromptStateByThreadId?.[normalizedThreadId]) {
      return;
    }
    const next = {
      ...(this.state.approvalPromptStateByThreadId || {}),
    };
    delete next[normalizedThreadId];
    this.state.approvalPromptStateByThreadId = next;
    this.save();
  }

  getAvailableModelCatalog() {
    const raw = this.state.availableModelCatalog;
    if (!raw || typeof raw !== "object") {
      return null;
    }
    const models = normalizeModelCatalog(raw.models);
    if (!models.length) {
      return null;
    }
    const updatedAt = normalizeValue(raw.updatedAt);
    return { models, updatedAt };
  }

  setAvailableModelCatalog(models) {
    const normalizedModels = normalizeModelCatalog(models);
    if (!normalizedModels.length) {
      return null;
    }
    this.state.availableModelCatalog = {
      models: normalizedModels,
      updatedAt: new Date().toISOString(),
    };
    this.save();
    return this.state.availableModelCatalog;
  }

  buildBindingKey({ workspaceId, accountId, senderId }) {
    return `${normalizeValue(workspaceId)}:${normalizeValue(accountId)}:${normalizeValue(senderId)}`;
  }
}

function createEmptyState() {
  return {
    bindings: {},
    approvalCommandAllowlistByWorkspaceRoot: {},
    approvalPromptStateByThreadId: {},
    availableModelCatalog: {
      models: [],
      updatedAt: "",
    },
  };
}

function normalizeValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeThreadValue(value) {
  return typeof value === "string" ? value.replace(/\s+/g, "").trim() : "";
}

function getLegacyThreadMap(binding) {
  return binding?.threadIdByWorkspaceRoot && typeof binding.threadIdByWorkspaceRoot === "object"
    ? binding.threadIdByWorkspaceRoot
    : {};
}

function getThreadRuntimeMap(binding) {
  return binding?.threadIdByWorkspaceRootByRuntime && typeof binding.threadIdByWorkspaceRootByRuntime === "object"
    ? binding.threadIdByWorkspaceRootByRuntime
    : {};
}

function getThreadMapForRuntime(binding, runtimeId) {
  const normalizedRuntimeId = normalizeValue(runtimeId);
  const runtimeMap = getThreadRuntimeMap(binding);
  if (!normalizedRuntimeId) {
    return {};
  }
  const scoped = runtimeMap[normalizedRuntimeId];
  return scoped && typeof scoped === "object" ? scoped : {};
}

function getPendingThreadRuntimeMap(binding) {
  return binding?.pendingThreadIdByWorkspaceRootByRuntime && typeof binding.pendingThreadIdByWorkspaceRootByRuntime === "object"
    ? binding.pendingThreadIdByWorkspaceRootByRuntime
    : {};
}

function getPendingThreadMapForRuntime(binding, runtimeId) {
  const normalizedRuntimeId = normalizeValue(runtimeId);
  const runtimeMap = getPendingThreadRuntimeMap(binding);
  if (!normalizedRuntimeId) {
    return {};
  }
  const scoped = runtimeMap[normalizedRuntimeId];
  return scoped && typeof scoped === "object" ? scoped : {};
}

function getCodexParamsMap(binding) {
  return binding?.codexParamsByWorkspaceRoot && typeof binding.codexParamsByWorkspaceRoot === "object"
    ? binding.codexParamsByWorkspaceRoot
    : {};
}

function isSameTokenList(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
}

module.exports = { SessionStore };
