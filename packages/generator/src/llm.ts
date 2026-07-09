// LLM abstraction. The classifier depends only on this interface, so it can be
// unit-tested with a fake and the package builds without the Anthropic SDK
// installed (the SDK is an optionalDependency, imported lazily).

/** One block sent to the model; static blocks can be marked cacheable. */
export interface PromptBlock {
  text: string;
  /** Mark this block for prompt caching (static across grouped calls). */
  cache?: boolean;
}

export interface LLMRequest {
  system: PromptBlock[];
  user: string;
  /** JSON schema the reply must satisfy (enforced via tool-use). */
  schema: Record<string, unknown>;
  /** Name of the synthetic tool the model must call. */
  toolName: string;
}

/** Returns the parsed JSON object the model produced for `schema`. */
export type LLMClient = (req: LLMRequest) => Promise<unknown>;

export interface AnthropicOptions {
  apiKey: string;
  model?: string;
  maxTokens?: number;
}

/**
 * Build an LLMClient backed by the Anthropic SDK. Uses tool-use to force
 * schema-valid JSON, and marks cacheable system blocks with cache_control so
 * the taxonomy + document text are cached across the grouped per-clause calls.
 *
 * Imported lazily so `@autotos/generator` builds/tests without the SDK present.
 */
export async function createAnthropicClient(
  opts: AnthropicOptions,
): Promise<LLMClient> {
  const mod = await import("@anthropic-ai/sdk").catch(() => {
    throw new Error(
      "@anthropic-ai/sdk is not installed. Run `npm i @anthropic-ai/sdk` in packages/generator.",
    );
  });
  const Anthropic = (mod as { default: new (o: { apiKey: string }) => unknown }).default;
  const client = new Anthropic({ apiKey: opts.apiKey }) as {
    messages: { create: (body: unknown) => Promise<unknown> };
  };
  const model = opts.model ?? "claude-opus-4-8";
  const maxTokens = opts.maxTokens ?? 2048;

  return async (req: LLMRequest): Promise<unknown> => {
    const system = req.system.map((b) => ({
      type: "text",
      text: b.text,
      ...(b.cache ? { cache_control: { type: "ephemeral" } } : {}),
    }));

    const resp = (await client.messages.create({
      model,
      max_tokens: maxTokens,
      system,
      tools: [
        {
          name: req.toolName,
          description: "Return the structured classification result.",
          input_schema: req.schema,
        },
      ],
      tool_choice: { type: "tool", name: req.toolName },
      messages: [{ role: "user", content: req.user }],
    })) as { content: Array<{ type: string; name?: string; input?: unknown }> };

    const toolUse = resp.content.find(
      (c) => c.type === "tool_use" && c.name === req.toolName,
    );
    if (!toolUse?.input) {
      throw new Error(`Model did not call tool ${req.toolName}`);
    }
    return toolUse.input;
  };
}
