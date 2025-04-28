import { Anthropic } from "@anthropic-ai/sdk"
import axios from "axios"
import { setTimeout as setTimeoutPromise } from "node:timers/promises"
import OpenAI from "openai"
import { ApiHandler } from "../"
import { ApiHandlerOptions, ModelInfo, nutstoreDefaultModelId, nutstoreDefaultModelInfo } from "../../shared/api"
import { withRetry } from "../retry"
import { createOpenRouterStream } from "../transform/openrouter-stream"
import { ApiStream, ApiStreamUsageChunk } from "../transform/stream"
import { OpenRouterErrorResponse } from "./types"

export class NutstoreHandler implements ApiHandler {
	private options: ApiHandlerOptions
	private client: OpenAI
	lastGenerationId?: string
	private host: string = "https://ai-assistant.jianguoyun.net.cn"
	// private host: string = "http://localhost.eo2suite.cn:9000"

	constructor(options: ApiHandlerOptions) {
		this.options = options
		this.client = new OpenAI({
			baseURL: `${this.host}/cline/llm-router`,
			apiKey: "", // put AccessToken in header for verification
			defaultHeaders: {
				"HTTP-Referer": "https://cline.bot", // Optional, for including your app on openrouter.ai rankings.
				"X-Title": "Cline", // Optional. Shows in rankings on openrouter.ai.
				token: `${this.options.nutstoreAccessToken}`,
			},
		})
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[], taskId?: string): ApiStream {
		this.lastGenerationId = undefined

		const stream = await createOpenRouterStream(
			this.client,
			systemPrompt,
			messages,
			this.getModel(),
			this.options.o3MiniReasoningEffort,
			this.options.thinkingBudgetTokens,
			this.options.nutstoreProviderSorting,
			taskId,
		)

		let didOutputUsage: boolean = false

		for await (const chunk of stream) {
			// openrouter returns an error object instead of the openai sdk throwing an error
			if ("error" in chunk) {
				const error = chunk.error as OpenRouterErrorResponse["error"]
				console.error(`Nutstore API Error: ${error?.code} - ${error?.message}`)
				// Include metadata in the error message if available
				const metadataStr = error.metadata ? `\nMetadata: ${JSON.stringify(error.metadata, null, 2)}` : ""
				throw new Error(`Nutstore API Error ${error.code}: ${error.message}${metadataStr}`)
			}

			if (!this.lastGenerationId && chunk.id) {
				this.lastGenerationId = chunk.id
			}

			const delta = chunk.choices[0]?.delta
			if (delta?.content) {
				yield {
					type: "text",
					text: delta.content,
				}
			}

			// Reasoning tokens are returned separately from the content
			if ("reasoning" in delta && delta.reasoning) {
				yield {
					type: "reasoning",
					// @ts-ignore-next-line
					reasoning: delta.reasoning,
				}
			}

			if (!didOutputUsage && chunk.usage) {
				yield {
					type: "usage",
					inputTokens: chunk.usage.prompt_tokens || 0,
					outputTokens: chunk.usage.completion_tokens || 0,
					// @ts-ignore-next-line
					totalCost: chunk.usage.cost || 0,
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
				// console.log("OpenRouter generation details:", generation)
				return {
					type: "usage",
					// cacheWriteTokens: 0,
					// cacheReadTokens: 0,
					// openrouter generation endpoint fails often
					inputTokens: generation?.native_tokens_prompt || 0,
					outputTokens: generation?.native_tokens_completion || 0,
					totalCost: generation?.total_cost || 0,
				}
			} catch (error) {
				// ignore if fails
				console.error("Error fetching Nutstore generation details:", error)
			}
		}
		return undefined
	}

	@withRetry({ maxRetries: 4, baseDelay: 250, maxDelay: 1000, retryAllErrors: true })
	async *fetchGenerationDetails(genId: string) {
		// console.log("Fetching generation details for:", genId)
		try {
			const response = await axios.get(`${this.host}/cline/generation?id=${genId}`, {
				headers: {
					token: this.options.nutstoreAccessToken,
				},
				timeout: 15_000, // this request hangs sometimes
			})
			yield response.data?.data
		} catch (error) {
			// ignore if fails
			console.error("Error fetching OpenRouter generation details:", error)
			throw error
		}
	}

	getModel(): { id: string; info: ModelInfo } {
		const modelId = this.options.nutstoreModelId
		const modelInfo = this.options.nutstoreModelInfo
		if (modelId && modelInfo) {
			return { id: modelId, info: modelInfo }
		}
		return { id: nutstoreDefaultModelId, info: nutstoreDefaultModelInfo }
	}
}
