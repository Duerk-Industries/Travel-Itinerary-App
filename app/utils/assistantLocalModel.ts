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
