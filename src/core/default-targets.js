const { loadPersistedContextTokens } = require("../adapters/channel/weixin/context-token-store");

function resolvePreferredSenderId({
  config,
  accountId,
  explicitUser = "",
  sessionStore = null,
}) {
  const normalizedExplicitUser = normalizeText(explicitUser);
  if (normalizedExplicitUser) {
    return normalizedExplicitUser;
  }

  const configuredUsers = Array.isArray(config?.allowedUserIds)
    ? config.allowedUserIds.map((value) => normalizeText(value)).filter(Boolean)
    : [];
  if (configuredUsers.length) {
    return configuredUsers[0];
  }

  const bindingCandidates = collectBindingSenderIds({ config, accountId, sessionStore });
  if (bindingCandidates.length === 1) {
    return bindingCandidates[0];
  }

  const persistedUserIds = Object.keys(loadPersistedContextTokens(config, accountId) || {})
    .map((value) => normalizeText(value))
    .filter(Boolean);
  if (persistedUserIds.length === 1) {
    return persistedUserIds[0];
  }

  return "";
}

function resolvePreferredWorkspaceRoot({
  config,
  accountId,
  senderId = "",
  explicitWorkspace = "",
  sessionStore = null,
}) {
  const normalizedExplicitWorkspace = normalizeText(explicitWorkspace);
  if (normalizedExplicitWorkspace) {
    return normalizedExplicitWorkspace;
  }

  const normalizedSenderId = normalizeText(senderId);
  const normalizedAccountId = normalizeText(accountId);
  const store = sessionStore && typeof sessionStore.getBinding === "function"
    ? sessionStore
    : null;

  if (store && normalizedSenderId && normalizedAccountId) {
    const bindingKey = store.buildBindingKey({
      workspaceId: config.workspaceId,
      accountId: normalizedAccountId,
      senderId: normalizedSenderId,
    });
    const activeWorkspaceRoot = normalizeText(store.getActiveWorkspaceRoot(bindingKey));
    if (activeWorkspaceRoot) {
      return activeWorkspaceRoot;
    }

    const binding = store.getBinding(bindingKey);
    const boundWorkspaceRoots = collectWorkspaceRoots(binding);
    if (boundWorkspaceRoots.length === 1) {
      return boundWorkspaceRoots[0];
    }
  }

  const globalWorkspaceCandidates = collectBindingWorkspaceRoots({ config, accountId, sessionStore: store });
  if (globalWorkspaceCandidates.length === 1) {
    return globalWorkspaceCandidates[0];
  }

  return normalizeText(config?.workspaceRoot);
}

function collectBindingSenderIds({ config, accountId, sessionStore }) {
  const store = sessionStore && typeof sessionStore.getBinding === "function"
    ? sessionStore
    : null;
  if (!store) {
    return [];
  }
  const normalizedAccountId = normalizeText(accountId);
  if (!normalizedAccountId) {
    return [];
  }

  const senderIds = new Set();
  for (const binding of Object.values(store.state?.bindings || {})) {
    const bindingAccountId = normalizeText(binding?.accountId);
    const bindingWorkspaceId = normalizeText(binding?.workspaceId);
    const senderId = normalizeText(binding?.senderId);
    if (!senderId || bindingAccountId !== normalizedAccountId) {
      continue;
    }
    if (bindingWorkspaceId && bindingWorkspaceId !== normalizeText(config?.workspaceId)) {
      continue;
    }
    senderIds.add(senderId);
  }
  return Array.from(senderIds).sort((left, right) => left.localeCompare(right));
}

function collectBindingWorkspaceRoots({ config, accountId, sessionStore }) {
  const store = sessionStore && typeof sessionStore.getBinding === "function"
    ? sessionStore
    : null;
  if (!store) {
    return [];
  }
  const normalizedAccountId = normalizeText(accountId);
  const workspaceRoots = new Set();

  for (const binding of Object.values(store.state?.bindings || {})) {
    const bindingAccountId = normalizeText(binding?.accountId);
    const bindingWorkspaceId = normalizeText(binding?.workspaceId);
    if (bindingAccountId !== normalizedAccountId) {
      continue;
    }
    if (bindingWorkspaceId && bindingWorkspaceId !== normalizeText(config?.workspaceId)) {
      continue;
    }
    for (const workspaceRoot of collectWorkspaceRoots(binding)) {
      workspaceRoots.add(workspaceRoot);
    }
  }

  return Array.from(workspaceRoots).sort((left, right) => left.localeCompare(right));
}

function collectWorkspaceRoots(binding) {
  const workspaceRoots = new Set();
  const activeWorkspaceRoot = normalizeText(binding?.activeWorkspaceRoot);
  if (activeWorkspaceRoot) {
    workspaceRoots.add(activeWorkspaceRoot);
  }
  const runtimeThreadMap = binding?.threadIdByWorkspaceRootByRuntime && typeof binding.threadIdByWorkspaceRootByRuntime === "object"
    ? binding.threadIdByWorkspaceRootByRuntime
    : {};
  for (const scopedMap of Object.values(runtimeThreadMap)) {
    if (!scopedMap || typeof scopedMap !== "object") {
      continue;
    }
    for (const workspaceRoot of Object.keys(scopedMap)) {
      const normalizedWorkspaceRoot = normalizeText(workspaceRoot);
      if (normalizedWorkspaceRoot) {
        workspaceRoots.add(normalizedWorkspaceRoot);
      }
    }
  }
  for (const workspaceRoot of Object.keys(binding?.codexParamsByWorkspaceRoot || {})) {
    const normalizedWorkspaceRoot = normalizeText(workspaceRoot);
    if (normalizedWorkspaceRoot) {
      workspaceRoots.add(normalizedWorkspaceRoot);
    }
  }
  return Array.from(workspaceRoots).sort((left, right) => left.localeCompare(right));
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

module.exports = {
  resolvePreferredSenderId,
  resolvePreferredWorkspaceRoot,
};
