export function DragIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-square h-3 w-3">
      <rect width="18" height="18" x="3" y="3" rx="2"></rect>
    </svg>
  )
}

export function SettingsIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-settings h-3 w-3">
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path>
      <circle cx="12" cy="12" r="3"></circle>
    </svg>
  )
}

export function ImageUploadIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-image-up-icon lucide-image-up">
      <path d="M10.3 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10l-3.1-3.1a2 2 0 0 0-2.814.014L6 21" /><path d="m14 19.5 3-3 3 3" />
      <path d="M17 22v-5.5" />
      <circle cx="9" cy="9" r="2" />
    </svg>
  )
}

export function FreeformIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-layout-dashboard">
      <rect width="7" height="9" x="3" y="3" rx="1"></rect>
      <rect width="7" height="5" x="14" y="3" rx="1"></rect>
      <rect width="7" height="9" x="14" y="12" rx="1"></rect>
      <rect width="7" height="5" x="3" y="16" rx="1"></rect>
    </svg>
  )
}

export function RowIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-arrow-right-from-line">
      <path d="M3 5v14"></path>
      <path d="M21 12H7"></path>
      <path d="m15 18 6-6-6-6"></path>
    </svg>
  )
}

export function ColIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-arrow-down-from-line">
      <path d="M19 3H5"></path>
      <path d="M12 21V7"></path>
      <path d="m6 15 6 6 6-6"></path>
    </svg>
  )
}

export function AlignIcon(props: { value: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="14" height="14">
      {props.value === 'left' && (
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 6h14M3 10h18M3 14h14M3 18h18" />
      )}
      {props.value === 'center' && (
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 6h14M3 10h18M5 14h14M3 18h18" />
      )}
      {props.value === 'right' && (
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 6h14M3 10h18M7 14h14M3 18h18" />
      )}
      {props.value === 'justify' && (
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 6h18M3 10h18M3 14h18M3 18h18" />
      )}
    </svg>
  )
}

export function HAlignIcon(props: { value: string }) {
  return (
    <svg width="14" height="10" viewBox="0 0 14 10" fill="currentColor">
      {props.value === 'left' && (
        <>
          <rect x="0" y="0" width="8" height="2" rx="0.5" />
          <rect x="0" y="4" width="14" height="2" rx="0.5" />
          <rect x="0" y="8" width="5" height="2" rx="0.5" />
        </>
      )}
      {props.value === 'center' && (
        <>
          <rect x="3" y="0" width="8" height="2" rx="0.5" />
          <rect x="0" y="4" width="14" height="2" rx="0.5" />
          <rect x="4" y="8" width="5" height="2" rx="0.5" />
        </>
      )}
      {props.value === 'right' && (
        <>
          <rect x="6" y="0" width="8" height="2" rx="0.5" />
          <rect x="0" y="4" width="14" height="2" rx="0.5" />
          <rect x="9" y="8" width="5" height="2" rx="0.5" />
        </>
      )}
      {props.value === 'justify' && (
        <>
          <rect x="0" y="0" width="14" height="2" rx="0.5" />
          <rect x="0" y="4" width="14" height="2" rx="0.5" />
          <rect x="0" y="8" width="14" height="2" rx="0.5" />
        </>
      )}
    </svg>
  )
}

export function VAlignIcon(props: { value: string }) {
  return (
    <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor">
      {props.value === 'start' && (
        <>
          <rect x="0" y="0" width="10" height="2" rx="0.5" />
          <rect x="0" y="4" width="10" height="2" rx="0.5" />
          <rect x="0" y="8" width="6" height="2" rx="0.5" />
        </>
      )}
      {props.value === 'center' && (
        <>
          <rect x="0" y="1" width="10" height="2" rx="0.5" />
          <rect x="0" y="6" width="10" height="2" rx="0.5" />
          <rect x="0" y="11" width="6" height="2" rx="0.5" />
        </>
      )}
      {props.value === 'end' && (
        <>
          <rect x="0" y="2" width="10" height="2" rx="0.5" />
          <rect x="0" y="8" width="10" height="2" rx="0.5" />
          <rect x="0" y="12" width="6" height="2" rx="0.5" />
        </>
      )}
    </svg>
  )
}

export function VerticalPaddingIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-align-vertical-space-around h-3 w-3"><rect width="10" height="6" x="7" y="9" rx="2"></rect><path d="M22 20H2"></path><path d="M22 4H2"></path></svg>
  )
}
export function HorizontalPaddingIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-align-horizontal-space-around h-3 w-3"><rect width="6" height="10" x="9" y="7" rx="2"></rect><path d="M4 22V2"></path><path d="M20 22V2"></path></svg>
  )
}
export function BorderRadiusIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-scan w-3 h-3"><path d="M3 7V5a2 2 0 0 1 2-2h2"></path><path d="M17 3h2a2 2 0 0 1 2 2v2"></path><path d="M21 17v2a2 2 0 0 1-2 2h-2"></path><path d="M7 21H5a2 2 0 0 1-2-2v-2"></path></svg>
  )
}

export function TopLeftBorderRadiusIcon() {
  return (
    <svg role="presentation" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" class="w-3 h-3 opacity-50"><path d="M3 18V10.5C3 8.51088 3.79018 6.60322 5.1967 5.1967C6.60322 3.79018 8.51088 3 10.5 3H18"></path></svg>
  )
}
export function TopRightBorderRadiusIcon() {
  return (
    <svg role="presentation" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" class="w-3 h-3 opacity-50"><path d="M6 3H13.5C15.4891 3 17.3968 3.79018 18.8033 5.1967C20.2098 6.60322 21 8.51088 21 10.5V18"></path></svg>
  )
}

export function BottomLeftBorderRadiusIcon() {
  return (
    <svg role="presentation" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" class="w-3 h-3 opacity-50"><path d="M18 21H10.5C8.51088 21 6.60322 20.2098 5.1967 18.8033C3.79018 17.3968 3 15.4891 3 13.5V6"></path></svg>
  )
}

export function BottomRightBorderRadiusIcon() {
  return (
    <svg role="presentation" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" class="w-3 h-3 opacity-50"><path d="M21 6V13.5C21 15.4891 20.2098 17.3968 18.8033 18.8033C17.3968 20.2098 15.4891 21 13.5 21H6"></path></svg>
  )
}

export function LineHeightIcon() {
  return (
    <svg role="presentation" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" class="w-3 h-3 opacity-70"><path d="M21 2L3 2"></path><path d="M21 22L3 22"></path><path d="M6 19.1998L12 4.7998L18 19.1998"></path><path d="M8.00003 14.3984H16"></path></svg>
  )
}

export function LetterSpacingIcon() {
  return (
<svg role="presentation" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" class="w-3 h-3 opacity-70"><path d="M2 21L2 3"></path><path d="M22 21L22 3"></path><path d="M6 19.1998L12 4.7998L18 19.1998"></path><path d="M8.00003 14.3984H16"></path></svg>
  )
}
