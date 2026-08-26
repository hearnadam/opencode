import { AwsV4Signer } from "aws4fetch"
import { Effect } from "effect"
import { Headers } from "effect/unstable/http"
import { Auth, type AuthInput } from "../../route/auth.js"
import { ProviderShared } from "../shared.js"

/**
 * AWS credentials for SigV4 signing. Bedrock also supports Bearer API key auth,
 * which provider facades configure as route auth instead of SigV4.
 *
 * Credentials may be supplied either as a static object or as a resolver that is
 * invoked on every request. Pass a resolver backed by the AWS credential chain
 * (e.g. `fromNodeProviderChain`) to get short-lived STS credentials refreshed
 * automatically before they expire, instead of a fixed snapshot that goes stale.
 */
export interface Credentials {
  readonly region: string
  readonly accessKeyId: string
  readonly secretAccessKey: string
  readonly sessionToken?: string
}

/** Resolves fresh SigV4 credentials per request (e.g. from the AWS credential chain). */
export type CredentialResolver = () => Promise<Credentials>

const signRequest = (input: {
  readonly url: string
  readonly body: string
  readonly headers: Headers.Headers
  readonly credentials: Credentials
  readonly service: string
  readonly name: string
}) =>
  Effect.tryPromise({
    try: async () => {
      const signed = await new AwsV4Signer({
        url: input.url,
        method: "POST",
        headers: Object.entries(input.headers),
        body: input.body,
        region: input.credentials.region,
        accessKeyId: input.credentials.accessKeyId,
        secretAccessKey: input.credentials.secretAccessKey,
        sessionToken: input.credentials.sessionToken,
        service: input.service,
      }).sign()
      return Object.fromEntries(signed.headers.entries())
    },
    catch: (error) =>
      ProviderShared.invalidRequest(
        `${input.name} SigV4 signing failed: ${error instanceof Error ? error.message : String(error)}`,
      ),
  })

/**
 * Sign the exact JSON bytes with SigV4 using credentials configured on the route.
 *
 * `credentials` may be a static object or a {@link CredentialResolver}. A resolver
 * is called on every request, so a resolver backed by the AWS credential chain
 * keeps signing with fresh, unexpired credentials without rebuilding the model.
 */
export const sigV4 = (
  credentials: Credentials | CredentialResolver | undefined,
  options: { readonly service?: string; readonly name?: string } = {},
) =>
  Auth.custom((input: AuthInput) => {
    return Effect.gen(function* () {
      const name = options.name ?? "Bedrock Converse"
      if (!credentials) {
        return yield* ProviderShared.invalidRequest(
          `${name} requires either route bearer auth or AWS credentials configured on the route`,
        )
      }
      const resolved =
        typeof credentials === "function"
          ? yield* Effect.tryPromise({
              try: () => credentials(),
              catch: (error) =>
                ProviderShared.invalidRequest(
                  `${name} credential resolution failed: ${error instanceof Error ? error.message : String(error)}`,
                ),
            })
          : credentials
      const headersForSigning = Headers.set(input.headers, "content-type", "application/json")
      const signed = yield* signRequest({
        url: input.url,
        body: input.body,
        headers: headersForSigning,
        credentials: resolved,
        service: options.service ?? "bedrock",
        name,
      })
      return Headers.setAll(headersForSigning, signed)
    })
  })

/** Bedrock route auth defaults to SigV4 and expects credentials from route configuration. */
export const auth = sigV4(undefined)

export * as BedrockAuth from "./bedrock-auth.js"
