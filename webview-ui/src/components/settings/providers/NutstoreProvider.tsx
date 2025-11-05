import { createNutOAuthUrl } from "@nutstore/sso-js"
import { Mode } from "@shared/storage/types"
import { VSCodeCheckbox, VSCodeDropdown, VSCodeLink, VSCodeOption, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { useState } from "react"
import { useMount } from "react-use"
import { useExtensionState } from "@/context/ExtensionStateContext"
import VSCodeButtonLink from "../../common/VSCodeButtonLink"
import { useOpenRouterKeyInfo } from "../../ui/hooks/useOpenRouterKeyInfo"
import { DropdownContainer } from "../common/ModelSelector"
import NutstoreModelPicker, { OPENROUTER_MODEL_PICKER_Z_INDEX } from "../NutstoreModelPicker"
import { formatPrice } from "../utils/pricingUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"
import * as vscode from "vscode"

/**
 * Component to display OpenRouter balance information
 */
const NutstoreBalanceDisplay = ({ apiKey }: { apiKey: string }) => {
	const { data: keyInfo, isLoading, error } = useOpenRouterKeyInfo(apiKey)

	if (isLoading) {
		return <span style={{ fontSize: "12px", color: "var(--vscode-descriptionForeground)" }}>Loading...</span>
	}

	if (error || !keyInfo || keyInfo.limit === null) {
		// Don't show anything if there's an error, no info, or no limit set
		return null
	}

	// Calculate remaining balance
	const remainingBalance = keyInfo.limit - keyInfo.usage
	const formattedBalance = formatPrice(remainingBalance)

	return (
		<VSCodeLink
			href="https://openrouter.ai/settings/keys"
			style={{
				fontSize: "12px",
				color: "var(--vscode-foreground)",
				textDecoration: "none",
				fontWeight: 500,
				paddingLeft: 4,
				cursor: "pointer",
			}}
			title={`Remaining balance: ${formattedBalance}\nLimit: ${formatPrice(keyInfo.limit)}\nUsage: ${formatPrice(keyInfo.usage)}`}>
			Balance: {formattedBalance}
		</VSCodeLink>
	)
}

/**
 * Props for the OpenRouterProvider component
 */
interface NutstoreProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * The OpenRouter provider configuration component
 */
export const NutstoreProvider = ({ showModelOptions, isPopup, currentMode }: NutstoreProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange } = useApiConfigurationHandlers()

	const [providerSortingSelected, setProviderSortingSelected] = useState(!!apiConfiguration?.nutstoreProviderSorting)
	const [authUrl, setAuthUrl] = useState("")

	useMount(async () => {
		setAuthUrl(
			await createNutOAuthUrl({
				app: `cline-${vscode.env.uriScheme || "vscode"}`,
			}),
		)
	})

	return (
		<div>
			<div>
				<VSCodeTextField
					disabled
					style={{ width: "100%" }}
					type="password"
					value={apiConfiguration?.nutstoreAccessToken}></VSCodeTextField>
				<VSCodeButtonLink appearance="secondary" href={authUrl} style={{ margin: "5px 0 0 0" }}>
					Get Nutstore AccessToken
				</VSCodeButtonLink>
				<p
					style={{
						fontSize: "12px",
						marginTop: "5px",
						color: "var(--vscode-descriptionForeground)",
					}}>
					This key is stored locally and only used to make API requests from this extension.
				</p>
			</div>

			{showModelOptions && (
				<>
					<VSCodeCheckbox
						checked={providerSortingSelected}
						onChange={(e: any) => {
							const isChecked = e.target.checked === true
							setProviderSortingSelected(isChecked)
							if (!isChecked) {
								handleFieldChange("nutstoreProviderSorting", "")
							}
						}}
						style={{ marginTop: -10 }}>
						Sort underlying provider routing
					</VSCodeCheckbox>

					{providerSortingSelected && (
						<div style={{ marginBottom: -6 }}>
							<DropdownContainer className="dropdown-container" zIndex={OPENROUTER_MODEL_PICKER_Z_INDEX + 1}>
								<VSCodeDropdown
									onChange={(e: any) => {
										handleFieldChange("nutstoreProviderSorting", e.target.value)
									}}
									style={{ width: "100%", marginTop: 3 }}
									value={apiConfiguration?.nutstoreProviderSorting}>
									<VSCodeOption value="">Default</VSCodeOption>
									<VSCodeOption value="price">Price</VSCodeOption>
									<VSCodeOption value="throughput">Throughput</VSCodeOption>
									<VSCodeOption value="latency">Latency</VSCodeOption>
								</VSCodeDropdown>
							</DropdownContainer>
							<p style={{ fontSize: "12px", marginTop: 3, color: "var(--vscode-descriptionForeground)" }}>
								{!apiConfiguration?.nutstoreProviderSorting &&
									"Default behavior is to load balance requests across providers (like AWS, Google Vertex, Anthropic), prioritizing price while considering provider uptime"}
								{apiConfiguration?.nutstoreProviderSorting === "price" &&
									"Sort providers by price, prioritizing the lowest cost provider"}
								{apiConfiguration?.nutstoreProviderSorting === "throughput" &&
									"Sort providers by throughput, prioritizing the provider with the highest throughput (may increase cost)"}
								{apiConfiguration?.nutstoreProviderSorting === "latency" &&
									"Sort providers by response time, prioritizing the provider with the lowest latency"}
							</p>
						</div>
					)}

					<NutstoreModelPicker currentMode={currentMode} isPopup={isPopup} />
				</>
			)}
		</div>
	)
}
