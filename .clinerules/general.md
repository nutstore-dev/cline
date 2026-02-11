This file is the secret sauce for working effectively in this codebase. It captures tribal knowledge—the nuanced, non-obvious patterns that make the difference between a quick fix and hours of back-and-forth & human intervention.

**When to add to this file:**
- User had to intervene, correct, or hand-hold
- Multiple back-and-forth attempts were needed to get something working
- You discovered something that required reading many files to understand
- A change touched files you wouldn't have guessed
- Something worked differently than you expected
- User explicitly asks to "add this to CLAUDE.md"

**Proactively suggest additions** when any of the above happen—don't wait to be asked.

**What NOT to add:** Stuff you can figure out from reading a few files, obvious patterns, or standard practices. This file should be high-signal, not comprehensive.

## Miscellaneous
- This is a VS Code extension—check `package.json` for available scripts before trying to verify builds (e.g., `npm run compile`, not `npm run build`).
- When creating PRs, if the change is user-facing and significant enough to warrant a changelog entry, run `npm run changeset` and create a patch changeset. Never create minor or major version bumps. Skip changesets for trivial fixes, internal refactors, or minor UI tweaks that users wouldn't notice.
- When adding new feature flags, see this PR as a reference https://github.com/cline/cline/pull/7566
- Additional instructions about making requests: @.clinerules/network.md

## Extension Naming and package.json Configuration
This extension has been renamed from "claude-dev" to "cline" with publisher "jianguoyun" (坚果云/Nutstore). The naming conventions in `package.json` are critical for proper rendering:

**Core identifiers:**
- `"name": "cline"` - Extension identifier
- `"publisher": "jianguoyun"` - Publisher name (Nutstore/坚果云)
- `"displayName": "Cline-nutstore"` - Display name shown in VS Code

**Activity bar and view IDs must use "cline" prefix:**
- Activity bar container: `"id": "cline-ActivityBar"`
- Sidebar view: `"id": "cline.SidebarProvider"`
- All commands: `cline.*` (e.g., `cline.plusButtonClicked`, `cline.settingsButtonClicked`)
- All context keys: `cline.*` (e.g., `cline.isDevMode`, `cline.isGeneratingCommit`)

**Important:** After renaming from "claude-dev", all occurrences of "claude-dev-ActivityBar" and "claude" prefixes in view/command IDs must be updated to "cline" prefixes. Missing these updates prevents the extension UI from rendering correctly.

When adding new views, commands, or menus, always use the "cline" prefix to match this naming convention.

## gRPC/Protobuf Communication
The extension and webview communicate via gRPC-like protocol over VS Code message passing.

**Proto files live in `proto/`** (e.g., `proto/cline/task.proto`, `proto/cline/ui.proto`)
- Each feature domain has its own `.proto` file
- For simple data, use shared types in `proto/cline/common.proto` (`StringRequest`, `Empty`, `Int64Request`)
- For complex data, define custom messages in the feature's `.proto` file
- Naming: Services `PascalCaseService`, RPCs `camelCase`, Messages `PascalCase`
- For streaming responses, use `stream` keyword (see `subscribeToAuthCallback` in `account.proto`)

**Run `npm run protos`** after any proto changes—generates types in:
- `src/shared/proto/` - Shared type definitions
- `src/generated/grpc-js/` - Service implementations
- `src/generated/nice-grpc/` - Promise-based clients
- `src/generated/hosts/` - Generated handlers

**Adding new enum values** (like a new `ClineSay` type) requires updating conversion mappings in `src/shared/proto-conversions/cline-message.ts`

**Adding new RPC methods** requires:
- Handler in `src/core/controller/<domain>/`
- Call from webview via generated client: `UiServiceClient.scrollToSettings(StringRequest.create({ value: "browser" }))`

**Example—the `explain-changes` feature touched:**
- `proto/cline/task.proto` - Added `ExplainChangesRequest` message and `explainChanges` RPC
- `proto/cline/ui.proto` - Added `GENERATE_EXPLANATION = 29` to `ClineSay` enum
- `src/shared/ExtensionMessage.ts` - Added `ClineSayGenerateExplanation` type
- `src/shared/proto-conversions/cline-message.ts` - Added mapping for new say type
- `src/core/controller/task/explainChanges.ts` - Handler implementation
- `webview-ui/src/components/chat/ChatRow.tsx` - UI rendering

## Adding a New API Provider

### Quick Reference Checklist

When adding a new provider (e.g., "nutstore"), you must update files in a specific order. **Use the example of OpenRouter as a template** - search for "openrouter"/"openRouter" patterns and replicate them for your provider.

#### Phase 1: Proto Definitions (CRITICAL - do this first!)
1. **`proto/cline/models.proto`** - Add to `ApiProvider` enum with unique ID
   ```protobuf
   enum ApiProvider {
     // ...existing providers
     NUTSTORE = 41;  // Use next available ID
   }
   ```

2. **`proto/cline/models.proto`** - Add provider-specific fields to `ModelsApiOptions`
   ```protobuf
   message ModelsApiOptions {
     // Secrets (access tokens, API keys)
     optional string nutstore_access_token = 87;

     // Settings (provider-specific configs)
     optional string nutstore_provider_sorting = 88;

     // Plan mode model configuration
     optional string plan_mode_nutstore_model_id = 140;
     optional OpenRouterModelInfo plan_mode_nutstore_model_info = 141;

     // Act mode model configuration
     optional string act_mode_nutstore_model_id = 240;
     optional OpenRouterModelInfo act_mode_nutstore_model_info = 241;
   }
   ```

3. **`proto/cline/state.proto`** - Add secrets and settings
   ```protobuf
   message Secrets {
     optional string nutstore_access_token = 47;
   }

   message Settings {
     optional string nutstore_provider_sorting = 176;
   }
   ```

4. **Run `npm run protos`** - Regenerate TypeScript types from proto files

#### Phase 2: Proto Conversions (CRITICAL - prevents silent bugs!)
5. **`src/shared/proto-conversions/models/api-configuration-conversion.ts`**
   - Add case in `convertApiProviderToProto()` - maps string → proto enum
   - Add case in `convertProtoToApiProvider()` - maps proto enum → string
   - Add field conversions in both `convertApiConfigurationToProto()` and `convertProtoToApiConfiguration()`

   **⚠️ WARNING:** Missing these causes silent resets to Anthropic with no error!

#### Phase 3: Core Types and State
6. **`src/shared/api.ts`**
   - Add to `ApiProvider` union type
   - Define default model ID and ModelInfo
   - Export provider-specific types if needed

7. **`src/shared/storage/state-keys.ts`**
   - Add secrets to `SECRETS_KEYS` array
   - Add settings to `API_HANDLER_SETTINGS_FIELDS`
   - Add plan/act mode model fields to `API_HANDLER_SETTINGS_FIELDS`
   - **Run `npm run protos` again** - auto-updates proto files

8. **`src/shared/storage/provider-keys.ts`**
   - Add to `ProviderKeyMap` - maps provider to model ID key suffix
   - Add to `ProviderToApiKeyMap` - maps provider to API key/token field
   - Add to `ProviderDefaultModelMap` - sets default model
   - Import default model ID from `@shared/api`

#### Phase 4: API Handler
9. **`src/core/api/providers/your-provider.ts`**
   - Create handler class implementing `ApiHandler` interface
   - Use `createOpenAIClient()` from `@/shared/net` (not `new OpenAI()`)
   - Use `getAxiosSettings()` for all axios requests
   - See `openrouter.ts` or `nutstore.ts` as reference

10. **`src/core/api/index.ts`**
    - Import your handler
    - Add case in `createHandlerForProvider()` switch
    - Pass all mode-specific options (plan/act model IDs, reasoning effort, thinking budget, etc.)

#### Phase 5: Model Management
11. **`src/utils/model-utils.ts`**
    - Add to `isNextGenModelProvider()` if it's a next-gen provider
    - This enables native tool calling and advanced features

12. **`src/core/storage/StateManager.ts`**
    - Add to `modelInfoCache` type definition
    - Add to `modelInfoCache` initialization object
    - Add to `setModelsCache()` union type
    - Add to `getModelsCache()` union type
    - Add to `getModelInfo()` union type (if caching models)

#### Phase 6: UI Integration
13. **`src/shared/providers/providers.json`**
    - Add provider entry with value and label
    ```json
    {
      "value": "nutstore",
      "label": "Nutstore"
    }
    ```

14. **`webview-ui/src/components/settings/providers/YourProvider.tsx`**
    - Create provider-specific settings component
    - Handle authentication, base URLs, special options

15. **`webview-ui/src/components/settings/ApiOptions.tsx`**
    - Import your provider component
    - Add conditional rendering case

16. **`webview-ui/src/components/settings/utils/providerUtils.ts`**
    - Add case in `getModelsForProvider()` - return undefined if using OpenRouter models
    - Add case in `normalizeApiConfiguration()` - normalize model config
    - Add case in `copyConfigurationForMode()` - copy plan/act configs
    - Add case in `getCurrentModelForProvider()` - get current model info

17. **`webview-ui/src/utils/validate.ts`**
    - Add validation case for required fields

18. **`webview-ui/src/utils/getConfiguredProviders.ts`**
    - Add check for provider configuration (e.g., has API key)

### Common Patterns

**OpenRouter-Compatible Providers** (like Nutstore):
- Reuse `OpenRouterModelInfo` type for model info
- Use `createOpenRouterStream()` in handler
- Support provider sorting, reasoning effort, thinking budget
- Models can be sourced from OpenRouter's list

**OAuth Providers** (like OpenAI Codex):
- Add OAuth handler in `src/core/controller/account/`
- Use secrets storage for OAuth tokens
- Handle token refresh logic

**Local/Self-Hosted Providers** (like Ollama, LM Studio):
- Support base URL configuration
- May not need API keys
- Handle connection testing

### Merge Strategy for Upstream Updates

When merging upstream changes with custom provider:

1. **Accept upstream for all conflicts** except provider-specific files
2. **Provider-specific files to preserve:**
   - `src/core/api/providers/your-provider.ts` - Your handler
   - `webview-ui/src/components/settings/providers/YourProvider.tsx` - Your UI
   - Any provider-specific utilities

3. **Files that need manual merge:**
   - All proto files - add your provider enum and fields back
   - `src/core/api/index.ts` - re-add your case
   - `src/shared/api.ts` - re-add your types
   - All the checklist files above

4. **After merge:**
   - Run `npm run protos` to regenerate
   - Run `npm install` if dependencies changed
   - Test compilation with `node esbuild.mjs`
   - Test in VS Code with F5

### Testing Checklist

- [ ] Provider appears in dropdown
- [ ] Can authenticate/configure
- [ ] Model selection works
- [ ] Plan mode works
- [ ] Act mode works
- [ ] API calls succeed
- [ ] Error handling works
- [ ] Provider sorting works (if applicable)
- [ ] Model info caching works (if applicable)

### Troubleshooting

**Provider silently resets to Anthropic:**
- Check proto conversion in `api-configuration-conversion.ts`
- Verify enum value in `models.proto`
- Both directions must be implemented

**Missing model fields:**
- Verify state-keys.ts has all plan/act mode fields
- Run `npm run protos` after state-keys changes

**Type errors:**
- Check import paths after regenerating protos
- Verify ModelInfo type usage (use provider-specific or generic)

**Network/Proxy issues:**
- Must use `createOpenAIClient()` not `new OpenAI()`
- Must use `getAxiosSettings()` for axios
- See `.clinerules/network.md` for details

## Responses API Providers (OpenAI Codex, OpenAI Native)
Providers using OpenAI's Responses API require native tool calling. XML tools don't work with the Responses API.

**Symptoms of broken native tool calling:**
- Tools get called multiple times (e.g., `ask_followup_question` asks the same question twice)
- Tool arguments get duplicated or malformed
- The model responds but tools aren't recognized

**Root causes to check:**
1. **Provider missing from `isNextGenModelProvider()`** in `src/utils/model-utils.ts`. The native variant matchers (e.g., `native-gpt-5/config.ts`) call this function. If your provider isn't in the list, the matcher returns false and falls back to XML tools.

2. **Model missing `apiFormat: ApiFormat.OPENAI_RESPONSES`** in its model info (`src/shared/api.ts`). This property signals that the model requires native tool calling. The task runner in `src/core/task/index.ts` checks this and forces `enableNativeToolCalls: true` regardless of user settings.

**When adding a new Responses API provider:**
1. Add provider to `isNextGenModelProvider()` list in `src/utils/model-utils.ts`
2. Set `apiFormat: ApiFormat.OPENAI_RESPONSES` on all models that use the Responses API
3. The variant matcher and task runner will handle the rest automatically

## Adding Tools to System Prompt
This is tricky—multiple prompt variants and configs. **Always search for existing similar tools first and follow their pattern.** Look at the full chain from prompt definition → variant configs → handler → UI before implementing.

1. **Add to `ClineDefaultTool` enum** in `src/shared/tools.ts`
2. **Tool definition** in `src/core/prompts/system-prompt/tools/` (create file like `generate_explanation.ts`)
   - Define variants for each `ModelFamily` (generic, next-gen, xs, etc.)
   - Export variants array (e.g., `export const my_tool_variants = [GENERIC, NATIVE_NEXT_GEN, XS]`)
   - **Fallback behavior**: If a variant isn't defined for a model family, `ClineToolSet.getToolByNameWithFallback()` automatically falls back to GENERIC. So you only need to export `[GENERIC]` unless the tool needs model-specific behavior.
3. **Register in `src/core/prompts/system-prompt/tools/init.ts`** - Import and spread into `allToolVariants`
4. **Add to variant configs** - Each model family has its own config in `src/core/prompts/system-prompt/variants/*/config.ts`. Add your tool's enum to the `.tools()` list:
   - `generic/config.ts`, `next-gen/config.ts`, `gpt-5/config.ts`, `native-gpt-5/config.ts`, `native-gpt-5-1/config.ts`, `native-next-gen/config.ts`, `gemini-3/config.ts`, `glm/config.ts`, `hermes/config.ts`, `xs/config.ts`
   - **Important**: If you add to a variant's config, make sure the tool spec exports a variant for that ModelFamily (or relies on GENERIC fallback)
5. **Create handler** in `src/core/task/tools/handlers/`
6. **Wire up in `ToolExecutor.ts`** if needed for execution flow
7. **Add to tool parsing** in `src/core/assistant-message/index.ts` if needed
8. **If tool has UI feedback**: add `ClineSay` enum in proto, update `src/shared/ExtensionMessage.ts`, update `src/shared/proto-conversions/cline-message.ts`, update `webview-ui/src/components/chat/ChatRow.tsx`

## Modifying System Prompt
**Read these first:** `src/core/prompts/system-prompt/README.md`, `tools/README.md`, `__tests__/README.md`

System prompt is modular: **components** (reusable sections) + **variants** (model-specific configs) + **templates** (with `{{PLACEHOLDER}}` resolution).

**Key directories:**
- `components/` - Shared sections: `rules.ts`, `capabilities.ts`, `editing_files.ts`, etc.
- `variants/` - Model-specific: `generic/`, `next-gen/`, `xs/`, `gpt-5/`, `gemini-3/`, `hermes/`, `glm/`, etc.
- `templates/` - Template engine and placeholder definitions

**Variant tiers (ask user which to modify):**
- **Next-gen** (Claude 4, GPT-5, Gemini 2.5): `next-gen/`, `native-next-gen/`, `native-gpt-5/`, `native-gpt-5-1/`, `gemini-3/`, `gpt-5/`
- **Standard** (default fallback): `generic/`
- **Local/small models**: `xs/`, `hermes/`, `glm/`

**How overrides work:** Variants can override components via `componentOverrides` in their `config.ts`, or provide a custom template in `template.ts` (e.g., `next-gen/template.ts` exports `rules_template`). If no override, the shared component from `components/` is used.

**Example: Adding a rule to RULES section**
1. Check if variant overrides rules: look for `rules_template` in `variants/*/template.ts` or `componentOverrides.RULES` in `config.ts`
2. If shared: modify `components/rules.ts`
3. If overridden: modify that variant's template
4. XS variant is special—has heavily condensed inline content in `template.ts`

**After any changes, regenerate snapshots:**
```bash
UPDATE_SNAPSHOTS=true npm run test:unit
```
Snapshots live in `__tests__/__snapshots__/`. Tests validate across model families and context variations (browser, MCP, focus chain).

## Modifying Default Slash Commands
Three places need updates:
- `src/core/slash-commands/index.ts` - Command definitions
- `src/core/prompts/commands.ts` - System prompt integration
- `webview-ui/src/utils/slash-commands.ts` - Webview autocomplete

## Adding New Global State Keys
Adding a new key to global state requires updates in multiple places. Missing any step causes silent failures.

Required steps:
1. Type definition in `src/shared/storage/state-keys.ts` - Add to `GlobalState` or `Settings` interface
2. Read from globalState in `src/core/storage/utils/state-helpers.ts`:
   - Add `const myKey = context.globalState.get<GlobalStateAndSettings["myKey"]>("myKey")` in `readGlobalStateFromDisk()`
   - Add to the return object: `myKey: myKey ?? defaultValue,`
3. StateManager handles read/write via `setGlobalState()`/`getGlobalStateKey()` after initialization

Common mistake: Adding only the return value without the `context.globalState.get()` call. This compiles but the value is always `undefined` on load.

## StateManager Cache vs Direct globalState Access
StateManager uses an in-memory cache populated during `StateManager.initialize(context)` in `common.ts`. For most state, use `controller.stateManager.setGlobalState()`/`getGlobalStateKey()`.

Exception: State needed immediately at extension startup (before cache is ready)

When Window A sets state and immediately opens Window B, the new window's StateManager cache is populated from `context.globalState` during initialization. If you need to read state in Window B right at startup (e.g., in `common.ts` during `initialize()`), read directly from `context.globalState.get()` instead of StateManager's cache.

Example pattern (see `lastShownAnnouncementId` and `worktreeAutoOpenPath`):
```typescript
// Writing (normal pattern)
controller.stateManager.setGlobalState("myKey", value)

// Reading at startup in common.ts (bypass cache)
const value = context.globalState.get<string>("myKey")
```

This is only needed for cross-window state read during the brief startup window before StateManager cache is fully usable. Normal state access after initialization should use StateManager.

## ChatRow Cancelled/Interrupted States
When a ChatRow displays a loading/in-progress state (spinner), you must handle what happens when the task is cancelled. This is non-obvious because cancellation doesn't update the message content—you have to infer it from context.

**The pattern:**
1. A message has a `status` field (e.g., `"generating"`, `"complete"`, `"error"`) stored in `message.text` as JSON
2. When cancelled mid-operation, the status stays `"generating"` forever—no one updates it
3. To detect cancellation, check TWO conditions:
   - `!isLast` — if this message is no longer the last message, something else happened after it (interrupted)
   - `lastModifiedMessage?.ask === "resume_task" || "resume_completed_task"` — task was just cancelled and is waiting to resume

**Example from `generate_explanation`:**
```tsx
const wasCancelled =
    explanationInfo.status === "generating" &&
    (!isLast ||
        lastModifiedMessage?.ask === "resume_task" ||
        lastModifiedMessage?.ask === "resume_completed_task")
const isGenerating = explanationInfo.status === "generating" && !wasCancelled
```

**Why both checks?**
- `!isLast` catches: cancelled → resumed → did other stuff → this old message is stale
- `lastModifiedMessage?.ask === "resume_task"` catches: just cancelled, hasn't resumed yet, this message is still technically "last"

**See also:** `BrowserSessionRow.tsx` uses similar pattern with `isLastApiReqInterrupted` and `isLastMessageResume`.

**Backend side:** When streaming is cancelled, clean up properly (close tabs, clear comments, etc.) by checking `taskState.abort` after the streaming function returns.
