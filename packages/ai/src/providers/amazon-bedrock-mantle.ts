import { Auth } from "../route/auth.js"
import { Route, type RouteDefaultsInput } from "../route/client.js"
import type { ProviderPackage } from "../provider-package.js"
import { OpenAIChat } from "../protocols/openai-chat.js"
import { OpenAIResponses } from "../protocols/openai-responses.js"
import { BedrockAuth, type Credentials, type CredentialResolver } from "../protocols/utils/bedrock-auth.js"
import { ProviderID, type ModelID } from "../schema/index.js"
import { withOpenAIOptions, type OpenAIProviderOptionsInput } from "./openai-options.js"
import { AmazonBedrockShared } from "./amazon-bedrock-shared.js"

export const id = ProviderID.make("amazon-bedrock")

export type Config = RouteDefaultsInput & {
  readonly apiKey?: string
  readonly baseURL?: string
  readonly credentials?: Credentials | CredentialResolver
  /** AWS profile for the credential chain when signing with SigV4 (no apiKey/credentials). */
  readonly profile?: string
  readonly region?: string
  readonly providerOptions?: OpenAIProviderOptionsInput
}

export interface Settings extends ProviderPackage.Settings {
  readonly apiKey?: string
  readonly auth?: "bearer" | "sigv4"
  readonly baseURL?: string
  readonly credentials?: Credentials
  readonly profile?: string
  readonly region?: string
  readonly topP?: number
  readonly providerOptions?: OpenAIProviderOptionsInput
}

const responsesRoute = Route.make({
  id: "bedrock-mantle-responses",
  provider: id,
  providerMetadataKey: "mantle",
  protocol: OpenAIResponses.protocol,
  endpoint: OpenAIResponses.route.endpoint,
  auth: OpenAIResponses.route.auth,
  transport: OpenAIResponses.httpTransport,
  defaults: OpenAIResponses.route.defaults,
})

const chatRoute = OpenAIChat.route.with({
  id: "bedrock-mantle-chat",
  provider: id,
  providerMetadataKey: "mantle",
})

export const routes = [responsesRoute, chatRoute]

const configuredRoute = <Body, Prepared>(route: Route<Body, Prepared>, input: Config) => {
  const staticCredentials = typeof input.credentials === "function" ? undefined : input.credentials
  const region = input.region ?? staticCredentials?.region ?? "us-east-1"
  const credentials =
    input.credentials === undefined
      ? undefined
      : typeof input.credentials === "function"
        ? input.credentials
        : { ...input.credentials, region }
  return route.with({
    endpoint: { baseURL: input.baseURL ?? `https://bedrock-mantle.${region}.api.aws/v1` },
    auth:
      input.apiKey === undefined
        ? BedrockAuth.sigV4(credentials, { service: "bedrock-mantle", name: "Bedrock Mantle" })
        : Auth.bearer(input.apiKey),
  })
}

const defaults = (input: Config) => {
  const { apiKey: _, baseURL: _baseURL, credentials: _credentials, profile: _profile, region: _region, ...rest } = input
  return rest
}

export const configure = (input: Config = {}) => {
  // Default to SigV4 via the AWS credential chain (auto-refreshing) when neither an
  // API key nor explicit credentials are provided — mirrors google-vertex's ADC. One
  // shared resolver is built so both routes reuse the same memoized/refreshing chain.
  const resolved: Config =
    input.apiKey === undefined && input.credentials === undefined
      ? {
          ...input,
          credentials: AmazonBedrockShared.chainCredentials(
            input.region ?? "us-east-1",
            AmazonBedrockShared.profile(input.profile),
          ),
        }
      : input
  const configuredResponsesRoute = configuredRoute(responsesRoute, resolved)
  const configuredChatRoute = configuredRoute(chatRoute, resolved)
  const modelDefaults = defaults(resolved)
  const responses = (modelID: string | ModelID) =>
    configuredResponsesRoute
      .with(withOpenAIOptions(modelID, modelDefaults))
      .model<OpenAIProviderOptionsInput>({ id: modelID })
  const chat = (modelID: string | ModelID) =>
    configuredChatRoute
      .with(withOpenAIOptions(modelID, modelDefaults))
      .model<OpenAIProviderOptionsInput>({ id: modelID })

  return {
    id,
    model: chat,
    chat,
    responses,
    configure,
  }
}

export const provider = configure()

const config = (settings: Settings): Config => {
  if (settings.auth === "bearer" && settings.apiKey === undefined)
    throw new Error("Amazon Bedrock Mantle bearer auth requires apiKey")
  if (settings.auth === "sigv4" && settings.apiKey !== undefined)
    throw new Error("Amazon Bedrock Mantle SigV4 auth does not accept apiKey")
  return {
    apiKey: settings.auth === "sigv4" ? undefined : settings.apiKey,
    baseURL: settings.baseURL,
    credentials: settings.credentials,
    profile: settings.profile,
    generation: settings.topP === undefined ? undefined : { topP: settings.topP },
    headers: settings.headers === undefined ? undefined : { ...settings.headers },
    http: settings.body === undefined ? undefined : { body: { ...settings.body } },
    providerOptions: settings.providerOptions,
    region: settings.region,
  }
}

export const chatModel: ProviderPackage.Definition<Settings, OpenAIProviderOptionsInput>["model"] = (
  modelID,
  settings,
) => configure(config(settings)).chat(modelID)
export const responsesModel: ProviderPackage.Definition<Settings, OpenAIProviderOptionsInput>["model"] = (
  modelID,
  settings,
) => configure(config(settings)).responses(modelID)
export const model = chatModel
