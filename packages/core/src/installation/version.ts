declare global {
  const OCTO_VERSION: string
  const OCTO_CHANNEL: string
}

export const InstallationVersion = typeof OCTO_VERSION === "string" ? OCTO_VERSION : "local"
export const InstallationChannel = typeof OCTO_CHANNEL === "string" ? OCTO_CHANNEL : "local"
export const InstallationLocal = InstallationChannel === "local"
