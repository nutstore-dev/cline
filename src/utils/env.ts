import { EmptyRequest, StringRequest } from "@shared/proto/cline/common"
import open from "open"
import { HostProvider } from "@/hosts/host-provider"

/**
 * Writes text to the system clipboard
 * @param text The text to write to the clipboard
 * @returns Promise that resolves when the operation is complete
 * @throws Error if the operation fails
 */
export async function writeTextToClipboard(text: string): Promise<void> {
	try {
		await HostProvider.env.clipboardWriteText(StringRequest.create({ value: text }))
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error)
		throw new Error(`Failed to write to clipboard: ${errorMessage}`)
	}
}

/**
 * Reads text from the system clipboard
 * @returns Promise that resolves to the clipboard text
 * @throws Error if the operation fails
 */
export async function readTextFromClipboard(): Promise<string> {
	try {
		const response = await HostProvider.env.clipboardReadText(EmptyRequest.create({}))
		return response.value
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error)
		throw new Error(`Failed to read from clipboard: ${errorMessage}`)
	}
}

/**
 * Opens an external URL in the default browser
 * @param url The URL to open
 * @returns Promise that resolves when the operation is complete
 * @throws Error if the operation fails
 */
export async function openExternal(url: string): Promise<void> {
	console.log("Opening browser:", url)
	await open(url)
}

/**
 * Gets the URI scheme for the host environment (e.g. "vscode", "vscodium")
 * @returns Promise that resolves to the URI scheme
 * @throws Error if the operation fails
 */
export async function getUriScheme(): Promise<string> {
	try {
		const redirectUriResponse = await HostProvider.env.getIdeRedirectUri(EmptyRequest.create())
		// The response is a full URI like "vscode://...", so we parse the protocol
		return new URL(redirectUriResponse.value).protocol.slice(0, -1)
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error)
		throw new Error(`Failed to get URI scheme: ${errorMessage}`)
	}
}
