/** Joins class names, skipping falsy parts. */
export const cx = (...parts: Array<string | false | null | undefined>) =>
  parts.filter(Boolean).join(' ')

/** React drops data attributes set to undefined, so this renders a flag only when on. */
export const flag = (on: boolean | undefined) => (on ? '' : undefined)
