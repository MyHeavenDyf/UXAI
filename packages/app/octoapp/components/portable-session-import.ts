export const PORTABLE_SESSION_IMPORT_EVENT = "octo:portable-session-import"

export type PortableSessionImportResult = {
  sessionID: string
  sessions: number | string
  files: number | string
}

export type PortableSessionImportRequest = {
  path: string
  resolve: (result: PortableSessionImportResult) => void
  reject: (error: unknown) => void
}

export function requestPortableSessionImport(path: string) {
  return new Promise<PortableSessionImportResult>((resolve, reject) => {
    window.dispatchEvent(
      new CustomEvent<PortableSessionImportRequest>(PORTABLE_SESSION_IMPORT_EVENT, {
        detail: { path, resolve, reject },
      }),
    )
  })
}
