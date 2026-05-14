export function mergeRuntimeNamespace(existingNamespace, defaults) {
  const existing = existingNamespace || {};
  const merged = { ...existing };
  for (const [key, value] of Object.entries(defaults)) {
    if (merged[key] === undefined || merged[key] === null) merged[key] = value;
  }
  return Object.freeze(merged);
}

export function buildRuntimeSurface(existingRuntime, defaultsByNamespace) {
  const existing = existingRuntime || {};
  const surface = { ...existing };
  for (const [namespace, defaults] of Object.entries(defaultsByNamespace)) {
    surface[namespace] = mergeRuntimeNamespace(existing[namespace], defaults);
  }
  return Object.freeze(surface);
}
