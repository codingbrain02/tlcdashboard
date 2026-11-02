export const SUCCESS_TOAST_EVENT = 'tlc:success-toast'

// One root-level listener keeps feedback visible when a form closes or remounts.
export function showSuccessToast(message: string) {
  if (message.trim()) window.dispatchEvent(new CustomEvent(SUCCESS_TOAST_EVENT, { detail: message }))
}
