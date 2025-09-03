import { setTimeout as setTimeoutPromise } from "node:timers/promises"
import { Anthropic } from "@anthropic-ai/sdk"
import { ModelInfo, nutstoreDefaultModelId, nutstoreDefaultModelInfo } from "@shared/api"
import { shouldSkipReasoningForModel } from "@utils/model-utils"
import axios from "axios"
import OpenAI from "openai"
import * as vscode from "vscode"
import { ApiHandler, CommonApiHandlerOptions } from "../"
import { withRetry } from "../retry"
import { createOpenRouterStream } from "../transform/openrouter-stream"
import { ApiStream, ApiStreamUsageChunk } from "../transform/stream"
import { OpenRouterErrorResponse } from "./types"

interface NutstoreHandlerOptions extends CommonApiHandlerOptions {
	nutstoreAccessToken?: string
	nutstoreModelId?: string
	nutstoreModelInfo?: ModelInfo
	nutstoreProviderSorting?: string
	reasoningEffort?: string
	thinkingBudgetTokens?: number
}

export class NutstoreHandler implements ApiHandler {
	private options: NutstoreHandlerOptions
	private client: OpenAI | undefined
	lastGenerationId?: string
	private host: string = "https://ai-assistant.jianguoyun.net.cn"
	private uriScheme: string = vscode.env.uriScheme
	// private host: string = "http://localhost.eo2suite.cn:9000"

	constructor(options: NutstoreHandlerOptions) {
		this.options = options
	}

	private ensureClient(): OpenAI {
		if (!this.client) {
			if (!this.options.nutstoreAccessToken) {
				throw new Error("OpenRouter API key is required")
			}
			try {
				this.client = new OpenAI({
					baseURL: `${this.host}/cline-${this.uriScheme}/llm-router`,
					apiKey: "", // put AccessToken in header for verification
					defaultHeaders: {
						"HTTP-Referer": "https://cline.bot", // Optional, for including your app on openrouter.ai rankings.
						"X-Title": "Cline", // Optional. Shows in rankings on openrouter.ai.
						token: `${this.options.nutstoreAccessToken}`,
					},
				})
			} catch (error: any) {
				throw new Error(`Error creating OpenRouter client: ${error.message}`)
			}
		}
		return this.client
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[], taskId?: string): ApiStream {
		const client = this.ensureClient()
		this.lastGenerationId = undefined

		const stream = await createOpenRouterStream(
			client,
			systemPrompt,
			messages,
			this.getModel(),
			this.options.reasoningEffort,
			this.options.thinkingBudgetTokens,
			this.options.nutstoreProviderSorting,
			taskId,
		)

		let didOutputUsage: boolean = false

		for await (const chunk of stream) {
			// openrouter returns an error object instead of the openai sdk throwing an error
			// Check for error field directly on chunk
			if ("error" in chunk) {
				const error = chunk.error as OpenRouterErrorResponse["error"]
				console.error(`Nutstore API Error: ${error?.code} - ${error?.message}`)
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
					console.error(`Nutstore Mid-Stream Error: ${error?.code || "Unknown"} - ${error?.message || "Unknown error"}`)
					// Format error details
					const errorDetails = typeof error === "object" ? JSON.stringify(error, null, 2) : String(error)
					throw new Error(`Nutstore Mid-Stream Error: ${errorDetails}`)
				} else {
					// Fallback if error details are not available
					throw new Error(
						`Nutstore Mid-Stream Error: Stream terminated with error status but no error details provided`,
					)
				}
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
			// Skip reasoning content for Grok 4 models since it only displays "thinking" without providing useful information
			if ("reasoning" in delta && delta.reasoning && !shouldSkipReasoningForModel(this.options.nutstoreModelId)) {
				yield {
					type: "reasoning",
					// @ts-ignore-next-line
					reasoning: delta.reasoning,
				}
			}

			if (!didOutputUsage && chunk.usage) {
				yield {
					type: "usage",
					cacheWriteTokens: 0,
					cacheReadTokens: chunk.usage.prompt_tokens_details?.cached_tokens || 0,
					inputTokens: (chunk.usage.prompt_tokens || 0) - (chunk.usage.prompt_tokens_details?.cached_tokens || 0),
					outputTokens: chunk.usage.completion_tokens || 0,
					// @ts-ignore-next-line
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
				// console.log("OpenRouter generation details:", generation)
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
				console.error("Error fetching OpenRouter generation details:", error)
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
			console.error("Error fetching Nutstore generation details:", error)
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
