export const POLICY_STATUS_QUERY = ['policy-status'] as const

export type PolicyIntegrity =
  | 'ok'
  | 'unseeded'
  | 'unapproved'
  | 'locale-mismatch'
  | 'store-corrupt'

export type PolicyFileView = {
  path: string
  trusted: string | null
  disk: string | null
}

export type PolicyStatus = {
  integrity: PolicyIntegrity
  baselineDrift: boolean
  locale: string | null
  reviewReason: string | null
  files: PolicyFileView[]
}

