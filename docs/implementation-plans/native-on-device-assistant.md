# Native on-device assistant — scope

Status: **TABLED (2026-10-11).** Scoping only, nothing built. Decision: the assistant ships on desktop web only; phone browsers and the native apps show "only available on desktop web browsers for now". Revisit this document if phone or native support is wanted later.

Written 2026-10-10.

## Goal

Run the App Guide assistant locally inside the iOS and Android apps, as the web app already does with WebLLM. Today the native apps show "only available in the web app for now", because WebLLM needs WebGPU, which the React Native runtime does not have.

Out of scope: moving inference to a server (a different cost, privacy and latency trade-off), and action mode on phones (see Risks).

## What exists today (relevant to the work)

- `app/utils/assistantLocalModel.ts` loads the model with `loadAssistantEngine` and streams replies with `streamAssistantReply`. Both use WebLLM's `MLCEngine` and its OpenAI-style `engine.chat.completions.create({ stream: true })`.
- `app/hooks/useAssistantChat.ts` holds an `MLCEngine` in a ref (`engineRef`) and calls it directly. Prompt building, guide retrieval, history storage and tool/action parsing sit above that and are engine-independent.
- Phone browsers use `Llama-3.2-1B-Instruct-q4f16_1-MLC` and are guide-only. Desktop uses Qwen2.5 1.5B (guide) and 3B (actions).
- Metro stubs `@mlc-ai/web-llm` to an empty module on native (`metro.shared.cjs`), so nothing from WebLLM ships in the native bundles.
- The apps already use `expo-dev-client` and EAS builds, so adding a native module is routine. Each one needs a native rebuild.

## Options

| Option | Models | Platforms | Notes |
|---|---|---|---|
| **llama.rn** (llama.cpp binding) | Any GGUF: Llama 3.2 1B, Qwen2.5 1.5B/3B, etc. | iOS with Metal GPU; Android CPU, GPU support unclear and version-dependent | Most mature and flexible. Lower OS floors. Must be checked: structured/grammar-constrained output, which could help action mode. |
| **react-native-executorch** (Software Mansion) | Their packaged models, e.g. Llama 3.2 1B (a 1B quantized build is ~1.9 GB) | iOS 17+, Android 13+ (API 33), RN 0.81, New Architecture required | Good Expo story (resource-fetcher package, `useLLM` hook). One model runner at a time. Raises OS minimums. |
| **@react-native-ai/mlc** (Callstack, MLC engine) | Same MLC-format models and runtime family as the web app, so behavior is closest to what is already tested | iOS, Android | Setup needs the MLC toolchain and native build steps. Incubator-stage; verify current status before relying on it. |
| **Platform models** (Apple Foundation Models, Android Gemini Nano via ML Kit Prompt API) | The OS's built-in model | iOS 26 + Apple Intelligence devices only; Android Pixel/Galaxy flagships, alpha API | No download and no storage cost, but narrow device coverage, no official React Native binding for either. Possible later bonus, not a base. |

## Recommendation

1. Run a short spike between **llama.rn** and **react-native-executorch** (Phase 0) and pick on measured results.
2. Default expectation: **llama.rn**, because it keeps model choice open (the same 1B Llama, or Qwen if the evals favor it), has the lowest OS floors, and may allow grammar-constrained JSON for action mode.
3. Fall back to **react-native-executorch** if Android performance or build friction in llama.rn is poor.

## Work plan (engineer-days, estimates; one developer)

| Phase | Work | Days |
|---|---|---|
| 0. Spike | Both libraries in a throwaway dev build; Llama 3.2 1B on at least an older iPhone, a recent iPhone and a mid-range Android. Measure load time, peak RAM, tokens/sec, battery/thermal, and run the existing guide evaluation prompts. Decide. | 3–5 |
| 1. Engine abstraction | Define an `AssistantEngine` interface (`load`, `streamReply`, `interrupt`, `dispose`, progress callback). Wrap WebLLM in a web adapter. Change `useAssistantChat` and `assistantLocalModel` to depend on the interface, not `MLCEngine`. Split into `.web` / `.native` files so each platform only bundles its own engine (replaces the Metro stub). | 2–3 |
| 2. Native adapter | Chosen library behind the interface; chat template and stop tokens; context window and reply limits matching the web values; streaming and cancel; unload on app background and on memory warning. | 3–5 |
| 3. Model download manager | Download to app storage (resumable, progress, checksum, free-space check, cellular warning, delete); one model file (~0.8–1 GB for the 1B). Hosting: Hugging Face directly, or our own bucket for stability. | 3–5 |
| 4. UI and gating | Replace the "web only" message with a download prompt, progress and error states; storage management in Account; device gate (minimum RAM and OS) with a clear "not supported on this device" message; native panel behavior and tablet layout. | 3–5 |
| 5. QA | Device matrix (low/mid/high iPhone and Android, plus an iPad), low-memory and background/foreground cases, interrupted download, offline use, long conversations. Unit tests with a mocked engine. | 4–6 |
| 6. Release | Privacy notice and store privacy answers (inference stays on device; the model file is downloaded from a third party), app-size check, EAS build and TestFlight/internal-track rollout behind a feature flag. | 1–2 |
| **Total** | | **~19–31 (about 4–6 weeks)** |

## Risks and decisions needed

- **OS floors.** react-native-executorch needs iOS 17+ and Android 13+. The app currently uses Expo SDK 54 defaults, which are lower. Check install-base before accepting that.
- **Device memory.** A 1B model needs roughly 1 GB to run. Older or low-RAM phones will crash or be killed. A minimum-RAM gate is required, and it will exclude some users.
- **Download size and storage.** ~1 GB per user on first use. Decide whether it is opt-in only, Wi-Fi only by default, and how it is removed.
- **Action mode.** Validated only against a 3B model (9/10 vs 3/8 for 1.5B). A 1B model should stay guide-only. 3B on phones needs about 2.5 GB+ and probably an 8 GB-RAM-class device. Revisit only if grammar-constrained output makes a smaller model reliable.
- **Quality and speed.** Expect 1B on a phone to be noticeably slower and less accurate than the desktop 1.5B. The spike's eval run is the go/no-go for that.
- **Android acceleration.** GPU support in llama.rn on Android is described inconsistently across sources, so treat Android speed as unknown until measured.
- **Maintenance.** Native modules mean every Expo SDK upgrade needs a compatibility check of the chosen library.

## Acceptance criteria

- On supported devices, the App Guide answers the existing guide evaluation set at least as accurately as the current phone web build (Llama 3.2 1B).
- First-token latency and tokens/sec meet a target set from the spike (proposal: under 3 s to first token on a 3-year-old mid-range phone).
- No crashes or out-of-memory kills in the device matrix; the app unloads the model when backgrounded.
- Unsupported devices see a clear message and no download is offered.
- No conversation content leaves the device.

## Sources

- [react-native-executorch docs (useLLM)](https://docs.swmansion.com/react-native-executorch/docs/natural-language-processing/useLLM)
- [react-native-executorch quickstart (requirements)](https://www.mintlify.com/software-mansion/react-native-executorch/quickstart)
- [llama.rn on npm](https://www.npmjs.com/package/llama.rn/)
- [Callstack react-native-ai](https://github.com/callstackincubator/ai)
- [Callstack: MLC LLM + React Native](https://www.callstack.com/tutorials/mlc-llm-react-native-on-device-ai-without-the-pain)
- [ML Kit GenAI Prompt API (Android)](https://android-developers.googleblog.com/2025/10/ml-kit-genai-prompt-api-alpha-release.html)
- [Apple Foundation Models React Native wrapper](https://awesome.ecosyste.ms/projects/github.com%2Fdrewalth%2Freact-native-foundation-models)
