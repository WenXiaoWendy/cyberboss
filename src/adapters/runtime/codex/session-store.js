const fs = require("fs");
const path = require("path");
const { normalizeModelCatalog } = require("./model-catalog");

class SessionStore {
  constructor({ filePath }) {
    this.filePath = filePath;
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

  updateBinding(bindingKey, nextBinding) {
    this.state.bindings[bindingKey] = {
      ...(this.state.bindings[bindingKey] || {}),
      ...(nextBinding || {}),
    };
    this.save();
    return this.state.bindings[bindingKey];
  }

  getThreadIdForWorkspace(bindingKey, workspaceRoot) {
    const normalizedWorkspaceRoot = normalizeValue(workspaceRoot);
    if (!normalizedWorkspaceRoot) {
      return "";
    }
    return this.state.bindings[bindingKey]?.threadIdByWorkspaceRoot?.[normalizedWorkspaceRoot] || "";
  }

  setThreadIdForWorkspace(bindingKey, workspaceRoot, threadId, extra = {}) {
    const normalizedWorkspaceRoot = normalizeValue(workspaceRoot);
    if (!normalizedWorkspaceRoot) {
      return this.getBinding(bindingKey);
    }

    const current = this.getBinding(bindingKey) || {};
    const threadIdByWorkspaceRoot = {
      ...getThreadMap(current),
      [normalizedWorkspaceRoot]: normalizeValue(threadId),
    };

    return this.updateBinding(bindingKey, {
      ...current,
      ...extra,
      activeWorkspaceRoot: normalizedWorkspaceRoot,
      threadIdByWorkspaceRoot,
    });
  }

  clearThreadIdForWorkspace(bindingKey, workspaceRoot) {
    const normalizedWorkspaceRoot = normalizeValue(workspaceRoot);
    if (!normalizedWorkspaceRoot) {
      return this.getBinding(bindingKey);
    }
    const current = this.getBinding(bindingKey) || {};
    const threadIdByWorkspaceRoot = {
      ...getThreadMap(current),
      [normalizedWorkspaceRoot]: "",
    };
    return this.updateBinding(bindingKey, {
      ...current,
      threadIdByWorkspaceRoot,
    });
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
    availableModelCatalog: {
      models: [],
      updatedAt: "",
    },
  };
}

function normalizeValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function getThreadMap(binding) {
  return binding?.threadIdByWorkspaceRoot && typeof binding.threadIdByWorkspaceRoot === "object"
    ? binding.threadIdByWorkspaceRoot
    : {};
}

module.exports = { SessionStore };
