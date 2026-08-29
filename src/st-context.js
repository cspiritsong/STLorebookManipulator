const ADAPTER_MARKER = Symbol("stlorebookmanipulator.stContext");

export const ST_CAPABILITIES = Object.freeze({
  WORLD_INFO_NAMES: "worldInfoNames",
  LOAD_WORLD_INFO: "loadWorldInfo",
  SAVE_WORLD_INFO: "saveWorldInfo",
  WORLD_INFO: "worldInfo",
  RELOAD_WORLD_INFO_EDITOR: "reloadWorldInfoEditor",
  RELOAD_EDITOR: "reloadEditor",
  GENERATE_RAW: "generateRaw",
  GENERATION: "generation",
  CONNECTION_PROFILES: "connectionProfiles",
  CONNECTION_PROFILE_REQUESTS: "connectionProfileRequests",
  EVENTS: "events",
  STOP_GENERATION: "stopGeneration",
});

export class STContextError extends Error {
  constructor(message, code = "ST_CONTEXT_ERROR", cause = undefined) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "STContextError";
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}

export class STCapabilityError extends STContextError {
  constructor(capability, message = undefined) {
    super(
      message ||
        `SillyTavern capability "${capability}" is not available on the current context.`,
      "ST_CAPABILITY_MISSING",
    );
    this.name = "STCapabilityError";
    this.capability = capability;
  }
}

function isAdapter(value) {
  return Boolean(value && value[ADAPTER_MARKER]);
}

function isObjectLike(value) {
  return value !== null && (typeof value === "object" || typeof value === "function");
}

function getConnectionService(context) {
  return context?.ConnectionManagerRequestService;
}

export function detectCapabilities(context) {
  if (isAdapter(context)) return context.capabilities;

  const service = getConnectionService(context);
  const has = (name) => typeof context?.[name] === "function";
  const hasProfiles = typeof service?.getSupportedProfiles === "function";
  const hasProfileRequests = typeof service?.sendRequest === "function";

  return {
    context: isObjectLike(context),
    worldInfoNames: has("getWorldInfoNames"),
    loadWorldInfo: has("loadWorldInfo"),
    saveWorldInfo: has("saveWorldInfo"),
    worldInfo: has("loadWorldInfo") && has("saveWorldInfo"),
    reloadWorldInfoEditor: has("reloadWorldInfoEditor"),
    reloadEditor: has("reloadWorldInfoEditor"),
    generateRaw: has("generateRaw"),
    generation: has("generateRaw"),
    connectionProfiles: hasProfiles,
    connectionProfileRequests: hasProfileRequests,
    events:
      typeof context?.eventSource?.on === "function" &&
      isObjectLike(context?.eventTypes),
    stopGeneration: has("stopGeneration"),
  };
}

function resolveRawContext(context) {
  if (isAdapter(context)) return context.raw;
  if (context !== undefined && context !== null) return context;

  const sillyTavern = globalThis?.SillyTavern;
  if (!sillyTavern || typeof sillyTavern.getContext !== "function") {
    throw new STContextError(
      "SillyTavern.getContext() is not available. Open this extension inside SillyTavern.",
      "ST_CONTEXT_UNAVAILABLE",
    );
  }

  let rawContext;
  try {
    rawContext = sillyTavern.getContext();
  } catch (error) {
    throw new STContextError(
      `SillyTavern.getContext() failed: ${error?.message || String(error)}`,
      "ST_CONTEXT_UNAVAILABLE",
      error,
    );
  }

  if (!isObjectLike(rawContext)) {
    throw new STContextError(
      "SillyTavern.getContext() returned no usable context.",
      "ST_CONTEXT_UNAVAILABLE",
    );
  }
  return rawContext;
}

function invoke(target, method, args) {
  return target[method](...args);
}

function requireCapability(adapter, capability) {
  if (!adapter.capabilities[capability]) {
    throw new STCapabilityError(capability);
  }
}

export function createSTContext(context = undefined) {
  if (isAdapter(context)) return context;

  const raw = resolveRawContext(context);
  const capabilities = detectCapabilities(raw);

  const adapter = {
    [ADAPTER_MARKER]: true,
    raw,
    capabilities,

    getContext() {
      return raw;
    },

    hasCapability(capability) {
      return Boolean(capabilities[capability]);
    },

    requireCapability(capability) {
      requireCapability(adapter, capability);
      return adapter;
    },

    getWorldInfoNames(...args) {
      requireCapability(adapter, ST_CAPABILITIES.WORLD_INFO_NAMES);
      return invoke(raw, "getWorldInfoNames", args);
    },

    loadWorldInfo(...args) {
      requireCapability(adapter, ST_CAPABILITIES.LOAD_WORLD_INFO);
      return invoke(raw, "loadWorldInfo", args);
    },

    saveWorldInfo(...args) {
      requireCapability(adapter, ST_CAPABILITIES.SAVE_WORLD_INFO);
      return invoke(raw, "saveWorldInfo", args);
    },

    reloadWorldInfoEditor(...args) {
      if (!capabilities.reloadWorldInfoEditor) return false;
      return invoke(raw, "reloadWorldInfoEditor", args);
    },

    reloadEditor(...args) {
      return adapter.reloadWorldInfoEditor(...args);
    },

    generateRaw(...args) {
      requireCapability(adapter, ST_CAPABILITIES.GENERATE_RAW);
      return invoke(raw, "generateRaw", args);
    },

    getConnectionProfiles() {
      if (!capabilities.connectionProfiles) return [];
      const profiles = invoke(
        getConnectionService(raw),
        "getSupportedProfiles",
        [],
      );
      if (profiles == null) return [];
      if (!Array.isArray(profiles)) {
        throw new STContextError(
          "SillyTavern returned an invalid connection-profile list.",
          "ST_RESPONSE_INVALID",
        );
      }
      return profiles;
    },

    listConnectionProfiles() {
      return adapter.getConnectionProfiles();
    },

    sendRequest(...args) {
      requireCapability(adapter, ST_CAPABILITIES.CONNECTION_PROFILE_REQUESTS);
      return invoke(getConnectionService(raw), "sendRequest", args);
    },

    stopGeneration(...args) {
      if (!capabilities.stopGeneration) return false;
      return invoke(raw, "stopGeneration", args);
    },
  };

  // Keep UI-only SillyTavern values available while ensuring the API methods
  // above always resolve to the adapter's guarded implementations.
  return new Proxy(adapter, {
    get(target, property, receiver) {
      if (Reflect.has(target, property)) {
        return Reflect.get(target, property, receiver);
      }
      const value = raw?.[property];
      if (typeof value !== "function") return value;
      const functionProperties = Object.getOwnPropertyNames(value).filter(
        (name) => !["length", "name", "prototype", "arguments", "caller"].includes(name),
      );
      // Constructors such as SillyTavern's Popup expose static APIs
      // (Popup.show.confirm). Binding them as ordinary context methods would
      // create a new function and silently discard those static properties.
      return functionProperties.length > 0 ? value : value.bind(raw);
    },
    set(target, property, value, receiver) {
      if (Reflect.has(target, property)) {
        return Reflect.set(target, property, value, receiver);
      }
      if (isObjectLike(raw)) {
        raw[property] = value;
        return true;
      }
      return false;
    },
  });
}

export function getSTContext(context = undefined) {
  if (isAdapter(context)) return context;
  return createSTContext(resolveRawContext(context));
}

// Short alias for callers that want the adapter to be their only context entry
// point. It never calls SillyTavern.getContext() until invoked.
export const getContext = getSTContext;
