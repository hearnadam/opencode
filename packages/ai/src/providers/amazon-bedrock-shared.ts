import type { CredentialResolver } from "../protocols/utils/bedrock-auth.js"

/** Resolve the AWS region from an explicit value, the credentials, env, or a fallback. */
export const region = (value: string | undefined, credentialsRegion: string | undefined, fallback = "us-east-1") =>
  value ?? credentialsRegion ?? process.env.AWS_REGION ?? fallback

/** Resolve the AWS profile from an explicit value or the standard env var. */
export const profile = (value?: string) => value ?? process.env.AWS_PROFILE

/**
 * Build a SigV4 {@link CredentialResolver} backed by the AWS credential chain — env
 * vars, shared config/credentials, SSO, process credentials, container, and instance
 * roles. Mirrors `google-vertex-shared`'s ADC resolver: credentials are resolved on
 * every request, and the chain's provider memoizes and refreshes short-lived STS
 * credentials, so signing never uses an expired snapshot (no model rebuild needed).
 *
 * `@aws-sdk/credential-providers` is imported lazily so it only loads when SigV4 chain
 * auth is actually used, keeping bearer/static-credential paths dependency-free.
 */
export const chainCredentials = (regionValue: string, profileValue?: string): CredentialResolver => {
  let provider: (() => Promise<{ accessKeyId: string; secretAccessKey: string; sessionToken?: string }>) | undefined
  return async () => {
    if (!provider) {
      const { fromNodeProviderChain } = await import("@aws-sdk/credential-providers")
      provider = fromNodeProviderChain(profileValue ? { profile: profileValue } : {})
    }
    const creds = await provider()
    return {
      region: regionValue,
      accessKeyId: creds.accessKeyId,
      secretAccessKey: creds.secretAccessKey,
      sessionToken: creds.sessionToken,
    }
  }
}

export * as AmazonBedrockShared from "./amazon-bedrock-shared.js"
