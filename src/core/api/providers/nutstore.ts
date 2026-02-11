import { setTimeout as setTimeoutPromise } from "node:timers/promises"
import { StateManager } from "@core/storage/StateManager"
import { type ModelInfo, nutstoreDefaultModelId, nutstoreDefaultModelInfo } from "@shared/api"
import { shouldSkipReasoningForModel } from "@utils/model-utils"
import axios from "axios"
import type OpenAI from "openai"
import type { ChatCompletionTool as OpenAITool } from "openai/resources/chat/completions"
import type { ClineStorageMessage } from "@/shared/messages/content"
import { createOpenAIClient, getAxiosSettings } from "@/shared/net"
import { Logger } from "@/shared/services/Logger"
import { getUriScheme } from "@/utils/env"
import type { ApiHandler, CommonApiHandlerOptions } from "../"
import { withRetry } from "../retry"
import { createOpenRouterStream } from "../transform/openrouter-stream"
import type { ApiStream, ApiStreamUsageChunk } from "../transform/stream"
import { ToolCallProcessor } from "../transform/tool-call-processor"
import type { OpenRouterErrorResponse } from "./types"

interface NutstoreHandlerOptions extends CommonApiHandlerOptions {
	nutstoreAccessToken?: string
	nutstoreModelId?: string
	nutstoreModelInfo?: ModelInfo
	nutstoreProviderSorting?: string
	reasoningEffort?: string
	thinkingBudgetTokens?: number
	geminiThinkingLevel?: string
}

export class NutstoreHandler implements ApiHandler {
	private options: NutstoreHandlerOptions
	private client: OpenAI | undefined
	lastGenerationId?: string
	private host = "https://ai-assistant.jianguoyun.net.cn"
	// private host: string = "http://localhost.eo2suite.cn:9000"

	constructor(options: NutstoreHandlerOptions) {
		this.options = options
	}

	private async ensureClient(): Promise<OpenAI> {
		if (!this.client) {
			if (!this.options.nutstoreAccessToken) {
				throw new Error("Nutstore API key is required")
			}
			try {
				this.client = createOpenAIClient({
					baseURL: `${this.host}/cline-${await getUriScheme()}/llm-router`,
					apiKey: "", // put AccessToken in header for verification
					defaultHeaders: {
						"HTTP-Referer": "https://cline.bot", // Optional, for including your app on openrouter.ai rankings.
						"X-Title": "Cline", // Optional. Shows in rankings on openrouter.ai.
						token: `${this.options.nutstoreAccessToken}`,
					},
				})
			} catch (error: any) {
				throw new Error(`Error creating Nutstore client: ${error.message}`)
			}
		}
		return this.client
	}

	@withRetry()
	async *createMessage(
		systemPrompt: string,
		messages: ClineStorageMessage[],
		tools?: OpenAITool[],
		useResponseApi?: boolean,
		taskId?: string,
	): ApiStream {
		const client = await this.ensureClient()
		this.lastGenerationId = undefined

		const stream = await createOpenRouterStream(
			client,
			systemPrompt,
			messages,
			this.getModel(),
			this.options.reasoningEffort,
			this.options.thinkingBudgetTokens,
			this.options.nutstoreProviderSorting,
			tools,
			this.options.geminiThinkingLevel,
			taskId,
		)

		let didOutputUsage = false
		const toolCallProcessor = new ToolCallProcessor()

		for await (const chunk of stream) {
			// openrouter returns an error object instead of the openai sdk throwing an error
			// Check for error field directly on chunk
			if ("error" in chunk) {
				const error = chunk.error as OpenRouterErrorResponse["error"]
				Logger.error(`Nutstore API Error: ${error?.code} - ${error?.message}`)
				// Include metadata in the error message if available
				const metadataStr = error.metadata ? `\nMetadata: ${JSON.stringify(error.metadata, null, 2)}` : ""
				throw new Error(`Nutstore API Error ${error.code}: ${error.message}${metadataStr}`)
			}

			// Check for error in choices[0].finish_reason
			// OpenRouter may return errors in a non-standard way within choices
			const choice = chunk.choices?.[0]
			// Use type assertion since OpenRouter uses non-standard "error" finish_reason
			if ((choice?.finish_reason as string) === "error") {
				// Use type assertion since OpenRouter adds non-standard error property
				const choiceWithError = choice as any
				if (choiceWithError.error) {
					const error = choiceWithError.error
					Logger.error(`Nutstore Mid-Stream Error: ${error?.code || "Unknown"} - ${error?.message || "Unknown error"}`)
					// Format error details
					const errorDetails = typeof error === "object" ? JSON.stringify(error, null, 2) : String(error)
					throw new Error(`Nutstore Mid-Stream Error: ${errorDetails}`)
				}
				// Fallback if error details are not available
				throw new Error(`Nutstore Mid-Stream Error: Stream terminated with error status but no error details provided`)
			}

			if (!this.lastGenerationId && chunk.id) {
				this.lastGenerationId = chunk.id
			}

			const delta = chunk.choices?.[0]?.delta
			if (delta?.content) {
				yield {
					type: "text",
					text: delta.content,
				}
			}

			if (delta?.tool_calls) {
				yield* toolCallProcessor.processToolCallDeltas(delta.tool_calls)
			}

			// Reasoning tokens are returned separately from the content
			// Skip reasoning content for Grok 4 models since it only displays "thinking" without providing useful information
			if ("reasoning" in delta && delta.reasoning && !shouldSkipReasoningForModel(this.options.nutstoreModelId)) {
				yield {
					type: "reasoning",
					reasoning: typeof delta.reasoning === "string" ? delta.reasoning : JSON.stringify(delta.reasoning),
				}
			}

			// OpenRouter passes reasoning details that we can pass back unmodified in api requests to preserve reasoning traces for model
			// See: https://openrouter.ai/docs/use-cases/reasoning-tokens#preserving-reasoning-blocks
			if (
				"reasoning_details" in delta &&
				delta.reasoning_details &&
				// @ts-expect-error-next-line
				delta.reasoning_details.length && // exists and non-0
				!shouldSkipReasoningForModel(this.options.nutstoreModelId)
			) {
				yield {
					type: "reasoning",
					reasoning: "",
					details: delta.reasoning_details,
				}
			}

			if (!didOutputUsage && chunk.usage) {
				yield {
					type: "usage",
					cacheWriteTokens: 0,
					cacheReadTokens: chunk.usage.prompt_tokens_details?.cached_tokens || 0,
					inputTokens: (chunk.usage.prompt_tokens || 0) - (chunk.usage.prompt_tokens_details?.cached_tokens || 0),
					outputTokens: chunk.usage.completion_tokens || 0,
					// @ts-expect-error-next-line
					totalCost: (chunk.usage.cost || 0) + (chunk.usage.cost_details?.upstream_inference_cost || 0),
				}
				didOutputUsage = true
			}
		}

		// Fallback to generation endpoint if usage chunk not returned
		if (!didOutputUsage) {
			const apiStreamUsage = await this.getApiStreamUsage()
			if (apiStreamUsage) {
				yield apiStreamUsage
			}
		}
	}

	async getApiStreamUsage(): Promise<ApiStreamUsageChunk | undefined> {
		if (this.lastGenerationId) {
			await setTimeoutPromise(500) // FIXME: necessary delay to ensure generation endpoint is ready
			try {
				const generationIterator = this.fetchGenerationDetails(this.lastGenerationId)
				const generation = (await generationIterator.next()).value
				// Logger.log("Nutstore generation details:", generation)
				return {
					type: "usage",
					cacheWriteTokens: 0,
					cacheReadTokens: generation?.native_tokens_cached || 0,
					// openrouter generation endpoint fails often
					inputTokens: (generation?.native_tokens_prompt || 0) - (generation?.native_tokens_cached || 0),
					outputTokens: generation?.native_tokens_completion || 0,
					totalCost: generation?.total_cost || 0,
				}
			} catch (error) {
				// ignore if fails
				Logger.error("Error fetching Nutstore generation details:", error)
			}
		}
		return undefined
	}

	@withRetry({ maxRetries: 4, baseDelay: 250, maxDelay: 1000, retryAllErrors: true })
	async *fetchGenerationDetails(genId: string) {
		// Logger.log("Fetching generation details for:", genId)
		try {
			const response = await axios.get(`${this.host}/cline/generation?id=${genId}`, {
				headers: {
					token: this.options.nutstoreAccessToken,
				},
				timeout: 15_000, // this request hangs sometimes
				...getAxiosSettings(),
			})
			yield response.data?.data
		} catch (error) {
			// ignore if fails
			Logger.error("Error fetching Nutstore generation details:", error)
			throw error
		}
	}

	getModel(): { id: string; info: ModelInfo } {
		const modelId = this.options.nutstoreModelId || nutstoreDefaultModelId
		const cachedModelInfo = StateManager.get().getModelInfo("nutstore", modelId)
		return {
			id: modelId,
			info: cachedModelInfo || nutstoreDefaultModelInfo,
		}
	}
}
