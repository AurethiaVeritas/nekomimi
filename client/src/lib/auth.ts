import { withBasePath } from './basePath'
import { fetchWithRetry, requestJson } from './http'
import type { AuthUser } from '../types'

type UserResponse = { user: AuthUser | null }

export async function me(): Promise<UserResponse> {
  const r = await fetchWithRetry(withBasePath('/api/auth/me'), { credentials: 'include' })
  if (r.status === 401) return { user: null }
  if (!r.ok) throw new Error(await r.text())
  return r.json() as Promise<UserResponse>
}

export async function login(username: string, password: string): Promise<UserResponse> {
  return requestJson<UserResponse>(withBasePath('/api/auth/login'), {
    method: 'POST',
    json: { username, password },
  })
}

export async function logout(): Promise<{ ok: boolean }> {
  return requestJson<{ ok: boolean }>(withBasePath('/api/auth/logout'), { method: 'POST' })
}

export async function verifySetupToken(setupToken: string): Promise<{ ok: boolean }> {
  return requestJson<{ ok: boolean }>(withBasePath('/api/auth/setup-token'), {
    method: 'POST',
    json: { setupToken },
    retry: { retries: 0 },
  })
}

export async function bootstrap(username: string, password: string, setupToken: string): Promise<UserResponse> {
  return requestJson<UserResponse>(withBasePath('/api/auth/bootstrap'), {
    method: 'POST',
    json: { username, password, setupToken },
  })
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<{ ok: boolean }> {
  return requestJson<{ ok: boolean }>(withBasePath('/api/auth/change-password'), {
    method: 'POST',
    json: { currentPassword, newPassword },
  })
}
