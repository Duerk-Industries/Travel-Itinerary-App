import type { MLCEngine } from '@mlc-ai/web-llm';

/**
 * Thin wrapper around WebLLM (on-device LLM inference via WebGPU). Kept
 * behind this interface so the underlying library could be swapped later
 * without touching chat UI code -- see
 * docs/implementation_plans/implementation-plan-ai-assistant.md.
 *
 * Nothing in this file makes a network call to our own servers. Model
 * weights are fetched directly by WebLLM from its configured public model
 * CDN (Hugging Face / MLC-hosted), not proxied through us.
 */

export const DEFAULT_MODEL_ID = 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC';
export const HIGH_QUALITY_MODEL_ID = 'Qwen2.5-3B-Instruct-q4f16_1-MLC';

export type AssistantModelCapability = {
  supported: boolean;
  reason?: 'no-webgpu' | 'not-web' | 'unknown';
};

/**
 * Feature-detects whether this device/browser can realistically run an
 * on-device model at all. Deliberately conservative: on-device inference
 * that stutters or hangs the tab is worse than not offering the feature.
 */
export const detectAssistantModelCapability = (): AssistantModelCapability => {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') {
    return { supported: false, reason: 'not-web' };
  }
  const gpu = (navigator as Navigator & { gpu?: unknown }).gpu;
  if (!gpu) {
    return { supported: false, reason: 'no-webgpu' };
  }
  return { supported: true };
};

export type AssistantEngineLoadProgress = {
  progress: number; // 0..1
  text: string;
};

/**
 * Loads (or resumes from browser cache) the given model and returns a
 * ready-to-use WebLLM engine. Dynamic-imports the WebLLM library itself so
 * it never adds to the bundle for users who never open the assistant
 * panel (see performance notes in the implementation plan, section 6).
 */
export const loadAssistantEngine = async (
  modelId: string = DEFAULT_MODEL_ID,
  onProgress?: (report: AssistantEngineLoadProgress) => void
): Promise<MLCEngine> => {
  const { CreateMLCEngine } = await import('@mlc-ai/web-llm');
  return CreateMLCEngine(modelId, {
    initProgressCallback: (report) => {
      onProgress?.({ progress: report.progress, text: report.text });
    },
  });
};

export type AssistantChatRole = 'system' | 'user' | 'assistant';
export type AssistantChatMessage = { role: AssistantChatRole; content: string };

export type AssistantReplyUsage = {
  promptTokens: number;
  completionTokens: number;
  decodeTokensPerSecond: number;
  timeToFirstTokenSeconds: number;
};

export type AssistantReplyResult = {
  text: string;
  usage: AssistantReplyUsage | null;
};

// The context window every candidate model in the plan shares (see "Model
// selection" in the implementation plan) -- conversation history is pruned
// against this so a long chat can't silently truncate the system prompt or
// retrieved guide context out of the window.
export const MODEL_CONTEXT_WINDOW_TOKENS = 4096;
// Hard ceiling on a single reply, independent of the context window, so an
// underpowered device can't be tied up generating an unbounded response.
export const MAX_REPLY_TOKENS = 512;
// Low temperature deliberately: this is a grounded-answer guide, not creative
// writing, and a small on-device model drifts toward plausible-sounding but
// wrong specifics (e.g. calling the Transfers tab "the Flights tab" -- a
// real observation from manual testing) more readily at higher temperature.
export const ASSISTANT_TEMPERATURE = 0.2;

/**
 * Streams one assistant reply for the given message history. `onDelta` is
 * called with each incremental text chunk as it's generated (for a
 * progressively-appearing response in the UI); the returned promise
 * resolves once generation finishes with the full text and WebLLM's own
 * performance stats for this request.
 */
export const streamAssistantReply = async (
  engine: MLCEngine,
  messages: AssistantChatMessage[],
  onDelta?: (deltaText: string) => void
): Promise<AssistantReplyResult> => {
  const stream = await engine.chat.completions.create({
    messages,
    stream: true,
    stream_options: { include_usage: true },
    max_tokens: MAX_REPLY_TOKENS,
    temperature: ASSISTANT_TEMPERATURE,
  });

  let text = '';
  let usage: AssistantReplyUsage | null = null;
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) {
      text += delta;
      onDelta?.(delta);
    }
    if (chunk.usage) {
      usage = {
        promptTokens: chunk.usage.prompt_tokens,
        completionTokens: chunk.usage.completion_tokens,
        decodeTokensPerSecond: chunk.usage.extra.decode_tokens_per_s,
        timeToFirstTokenSeconds: chunk.usage.extra.time_to_first_token_s,
      };
    }
  }
  return { text, usage };
};
