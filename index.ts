import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import type { Api, Model } from "@mariozechner/pi-ai";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const FIREWORKS_PROVIDER = "fireworks";
const FIREWORKS_BASE_URL = "https://api.fireworks.ai/inference/v1";
const FIREWORKS_MODELS_API = `${FIREWORKS_BASE_URL}/models`;
const GLOBAL_MODELS_CACHE_PATH = join(
  homedir(),
  ".pi",
  "agent",
  "fireworks-models-cache.json",
);
const FIREWORKS_MODELS_RESPONSE_PATH = join(
  homedir(),
  ".pi",
  "agent",
  "fireworks-models-response.json",
);
const DEFAULT_COSTS = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
};
const DEFAULT_CONTEXT_WINDOW = 8192;
const FORCED_ROUTER_CONTEXT_WINDOW = 262144;

type ModelCost = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

type PiModel = Model<Api>;

type CuratedModelMetadata = Partial<PiModel> & {
  cost?: ModelCost;
};

interface FireworksApiModel {
  id: string;
  name?: string;
  context_length: number | null;
  pricing?: {
    input?: number;
    output?: number;
  };
  supports_chat: boolean;
  supports_image_input?: boolean;
}

interface FireworksApiResponse {
  data: FireworksApiModel[];
}

interface CachedModels {
  models: PiModel[];
  timestamp: number;
}

interface AuthJson {
  fireworks?: { key: string; type: string } | string;
  [key: string]: unknown;
}

const FORCE_INCLUDE_MODELS = [
  "accounts/fireworks/routers/kimi-k2p5-turbo",
] as const;

const FORCED_MODEL_IDS = new Set<string>(FORCE_INCLUDE_MODELS);

const CURATED_MODEL_METADATA: Record<string, CuratedModelMetadata> = {
  "accounts/fireworks/models/deepseek-v3p1": {
    name: "DeepSeek V3.1",
    reasoning: true,
    cost: { input: 0.56, output: 1.68, cacheRead: 0.28, cacheWrite: 0 },
    contextWindow: 163840,
    maxTokens: 163840,
  },
  "accounts/fireworks/models/deepseek-v3p2": {
    name: "Deepseek v3.2",
    reasoning: true,
    cost: { input: 0.56, output: 1.68, cacheRead: 0.28, cacheWrite: 0 },
    contextWindow: 163840,
    maxTokens: 163840,
  },
  "accounts/fireworks/models/minimax-m2p7": {
    name: "MiniMax M2.7",
    cost: { input: 0.3, output: 1.2, cacheRead: 0.06, cacheWrite: 0 },
    input: ["text", "image"],
    contextWindow: 196608,
    maxTokens: 196608,
  },
  "accounts/fireworks/models/kimi-k2p5": {
    name: "Kimi K2.5",
    reasoning: true,
    cost: { input: 0.6, output: 3.0, cacheRead: 0.1, cacheWrite: 0 },
    input: ["text", "image"],
    contextWindow: 262144,
    maxTokens: 262144,
  },
  "accounts/fireworks/models/kimi-k2p6": {
    name: "Kimi K2.6",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 262144,
    maxTokens: 262144,
  },
  "accounts/cogito/models/cogito-671b-v2-p1": {
    name: "Cogito 671B v2.1",
    reasoning: true,
    cost: { input: 1.2, output: 1.2, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 163840,
    maxTokens: 163840,
  },
  "accounts/fireworks/models/gpt-oss-120b": {
    name: "OpenAI gpt-oss-120b",
    reasoning: true,
    cost: { input: 0.15, output: 0.6, cacheRead: 0.01, cacheWrite: 0 },
    contextWindow: 131072,
    maxTokens: 131072,
  },
  "accounts/fireworks/models/glm-5p1": {
    name: "GLM 5.1",
    reasoning: true,
    cost: { input: 1.4, output: 4.4, cacheRead: 0.26, cacheWrite: 0 },
    contextWindow: 202752,
    maxTokens: 202752,
  },
  "accounts/fireworks/models/glm-5": {
    name: "GLM-5",
    reasoning: true,
    cost: { input: 1.0, output: 3.2, cacheRead: 0.2, cacheWrite: 0 },
    contextWindow: 202752,
    maxTokens: 202752,
  },
};

const getShortModelName = (modelId: string): string => {
  const parts = modelId.split("/");
  return parts[parts.length - 1] ?? modelId;
};

const getApiKey = async (): Promise<string | null> => {
  const envKey = process.env.FIREWORKS_API_KEY;
  if (envKey) {
    return envKey;
  }

  try {
    const authPath = join(homedir(), ".pi", "agent", "auth.json");
    const authContent = await readFile(authPath, "utf8");
    const auth = JSON.parse(authContent) as AuthJson;

    if (!auth.fireworks) {
      return null;
    }

    if (typeof auth.fireworks === "string") {
      return auth.fireworks;
    }

    if (auth.fireworks.type === "api_key" && auth.fireworks.key) {
      return auth.fireworks.key;
    }
  } catch {
    return null;
  }

  return null;
};

const fetchFireworksModels = async (
  apiKey: string,
): Promise<FireworksApiModel[]> => {
  const response = await fetch(FIREWORKS_MODELS_API, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
  });

  if (!response.ok) {
    throw new Error(
      `Fireworks API error: ${response.status} ${response.statusText}`,
    );
  }

  const data = (await response.json()) as FireworksApiResponse;
  await mkdir(dirname(FIREWORKS_MODELS_RESPONSE_PATH), { recursive: true });
  await writeFile(
    FIREWORKS_MODELS_RESPONSE_PATH,
    `${JSON.stringify(data, null, 2)}\n`,
    "utf8",
  );

  return data.data.filter((model) => {
    return (
      model.supports_chat === true &&
      model.context_length != null &&
      model.context_length > 0
    );
  });
};

const convertToPiModel = (apiModel: FireworksApiModel): PiModel => {
  const curated = CURATED_MODEL_METADATA[apiModel.id];
  const apiCost: ModelCost = apiModel.pricing
    ? {
        input: apiModel.pricing.input ?? 0,
        output: apiModel.pricing.output ?? 0,
        cacheRead: 0,
        cacheWrite: 0,
      }
    : DEFAULT_COSTS;

  return {
    id: apiModel.id,
    name:
      curated?.name ??
      apiModel.name ??
      `${getShortModelName(apiModel.id)} (Fireworks)`,
    api: "openai-completions" as Api,
    provider: FIREWORKS_PROVIDER,
    reasoning: curated?.reasoning ?? false,
    input: apiModel.supports_image_input ? ["text", "image"] : ["text"],
    cost: curated?.cost ?? apiCost,
    contextWindow: apiModel.context_length ?? DEFAULT_CONTEXT_WINDOW,
    maxTokens: apiModel.context_length ?? DEFAULT_CONTEXT_WINDOW,
  };
};

const createForcedModel = (modelId: string): PiModel => {
  const curated = CURATED_MODEL_METADATA[modelId];
  const isSubscriptionRouter = modelId.includes("routers/kimi-k2p5-turbo");

  return {
    id: modelId,
    name:
      curated?.name ??
      (isSubscriptionRouter
        ? `${getShortModelName(modelId)} (Fire Pass)`
        : `${getShortModelName(modelId)} (Fireworks)`),
    api: "openai-completions" as Api,
    provider: FIREWORKS_PROVIDER,
    reasoning: curated?.reasoning ?? true,
    input: ["text", "image"],
    cost: curated?.cost ?? DEFAULT_COSTS,
    contextWindow: FORCED_ROUTER_CONTEXT_WINDOW,
    maxTokens: FORCED_ROUTER_CONTEXT_WINDOW,
  };
};

const ensureForcedModels = (models: PiModel[]): PiModel[] => {
  const modelIds = new Set(models.map((model) => model.id));
  const output = [...models];

  for (const forcedModelId of FORCE_INCLUDE_MODELS) {
    if (!modelIds.has(forcedModelId)) {
      output.push(createForcedModel(forcedModelId));
    }
  }

  return output;
};

const normalizeCachedModels = (models: PiModel[]): PiModel[] => {
  return ensureForcedModels(models);
};

const readGlobalCachedModels = async (): Promise<CachedModels | null> => {
  try {
    const cacheContent = await readFile(GLOBAL_MODELS_CACHE_PATH, "utf8");
    const cache = JSON.parse(cacheContent) as CachedModels;

    if (!Array.isArray(cache.models)) {
      return null;
    }

    return {
      models: normalizeCachedModels(cache.models),
      timestamp: cache.timestamp,
    };
  } catch {
    return null;
  }
};

const readGlobalCachedModelsSync = (): CachedModels | null => {
  try {
    if (!existsSync(GLOBAL_MODELS_CACHE_PATH)) {
      return null;
    }

    const cacheContent = readFileSync(GLOBAL_MODELS_CACHE_PATH, "utf8");
    const cache = JSON.parse(cacheContent) as CachedModels;

    if (!Array.isArray(cache.models)) {
      return null;
    }

    return {
      models: normalizeCachedModels(cache.models),
      timestamp: cache.timestamp,
    };
  } catch {
    return null;
  }
};

const writeGlobalCachedModels = async (models: PiModel[]): Promise<void> => {
  const cache: CachedModels = {
    models: normalizeCachedModels(models),
    timestamp: Date.now(),
  };

  await mkdir(dirname(GLOBAL_MODELS_CACHE_PATH), { recursive: true });
  await writeFile(
    GLOBAL_MODELS_CACHE_PATH,
    `${JSON.stringify(cache, null, 2)}\n`,
    "utf8",
  );
};

const getStaticModels = (): PiModel[] => {
  const curatedModels = Object.entries(CURATED_MODEL_METADATA)
    .filter(([modelId]) => !FORCED_MODEL_IDS.has(modelId))
    .map(([modelId, metadata]) => {
      const contextWindow =
        metadata.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
      const maxTokens = metadata.maxTokens ?? contextWindow;

      return {
        id: modelId,
        name: metadata.name ?? modelId,
        api: "openai-completions" as Api,
        provider: FIREWORKS_PROVIDER,
        reasoning: metadata.reasoning ?? false,
        input: metadata.input ?? (["text"] as Array<"text" | "image">),
        cost: metadata.cost ?? DEFAULT_COSTS,
        contextWindow,
        maxTokens,
      };
    });

  return ensureForcedModels(curatedModels);
};

const createProviderConfig = (models: PiModel[]) => {
  return {
    api: "openai-completions" as Api,
    apiKey: "FIREWORKS_API_KEY",
    authHeader: true,
    baseUrl: FIREWORKS_BASE_URL,
    models,
  };
};

const notifyModelSource = (
  ctx: ExtensionContext,
  cached: CachedModels | null,
  models: PiModel[],
): void => {
  if (!ctx.hasUI) {
    return;
  }

  if (cached) {
    ctx.ui.notify(
      `Using cached Fireworks models (${models.length} models)`,
      "info",
    );
    return;
  }

  ctx.ui.notify(
    "Using static Fireworks models. Run /fireworks-refresh to fetch the latest list.",
    "info",
  );
};

const registerFireworksProvider = async (
  pi: ExtensionAPI,
  ctx: ExtensionContext,
): Promise<void> => {
  const cached = await readGlobalCachedModels();
  const models = cached?.models ?? getStaticModels();

  pi.registerProvider(FIREWORKS_PROVIDER, createProviderConfig(models));
  notifyModelSource(ctx, cached, models);
};

export default function fireworksExtension(pi: ExtensionAPI) {
  const startupModels = readGlobalCachedModelsSync()?.models ?? getStaticModels();

  pi.registerProvider(FIREWORKS_PROVIDER, createProviderConfig(startupModels));

  pi.on("session_start", async (_event, ctx) => {
    await registerFireworksProvider(pi, ctx);
  });

  pi.registerCommand("fireworks-refresh", {
    description: "Refresh Fireworks models from API and update the global cache",
    handler: async (_args, ctx) => {
      const apiKey = await getApiKey();

      if (!apiKey) {
        ctx.ui.notify("FIREWORKS_API_KEY not set", "error");
        return;
      }

      try {
        ctx.ui.notify("Fetching Fireworks models...", "info");

        const apiModels = await fetchFireworksModels(apiKey);
        const models = ensureForcedModels(apiModels.map(convertToPiModel));

        await writeGlobalCachedModels(models);
        pi.registerProvider(FIREWORKS_PROVIDER, createProviderConfig(models));

        ctx.ui.notify(
          `Refreshed ${models.length} Fireworks models and updated the global cache`,
          "success",
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Failed to refresh: ${message}`, "error");
      }
    },
  });

  pi.registerCommand("fireworks", {
    description: "Show Fireworks AI provider info and available models",
    handler: async (_args, ctx) => {
      const cache = await readGlobalCachedModels();
      const info = [
        "🔥 Fireworks AI Provider",
        "",
        "Authentication:",
        "  • Environment: FIREWORKS_API_KEY",
        "  • Auth file: ~/.pi/agent/auth.json → 'fireworks' key",
        "",
        "Cache:",
        `  • File: ${GLOBAL_MODELS_CACHE_PATH}`,
        `  • Status: ${
          cache ? `${cache.models.length} cached models` : "no cache yet"
        }`,
        `  • Last raw response file: ${FIREWORKS_MODELS_RESPONSE_PATH}`,
        "",
        "Commands:",
        "  • /fireworks-refresh - Fetch latest models from API and update the global cache",
        "",
        "Curated models (always available):",
        ...Object.entries(CURATED_MODEL_METADATA).map(([id, model]) => {
          return `  • ${model.name ?? id}`;
        }),
      ];

      ctx.ui.notify(info.join("\n"), "info");
    },
  });
}
