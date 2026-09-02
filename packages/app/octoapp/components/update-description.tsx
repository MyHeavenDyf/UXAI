export function UpdateDescription(props: { version: string; releaseNotes?: string }) {
  const releaseNotes = () => props.releaseNotes?.trim()

  return (
    <>
      {releaseNotes() ? (
        <p class="octo-update-dialog-description">
          V {props.version.replace(/^v/i, "")} {releaseNotes()}
        </p>
      ) : (
        <div class="octo-update-dialog-description-spacer" aria-hidden="true" />
      )}
      <style>{`
        .octo-update-dialog-description {
          margin: 12px 0 0;
          min-height: 63px;
          white-space: pre-wrap;
          font-size: 14px;
          line-height: 21px;
          font-weight: 400;
        }
        .octo-update-dialog-description-spacer {
          height: 75px;
        }
      `}</style>
    </>
  )
}
