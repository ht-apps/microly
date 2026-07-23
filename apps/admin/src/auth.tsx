/* oxlint-disable react/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

import { adminApi, adminUnauthorizedEvent, clearAdminToken, readAdminToken, saveAdminToken } from './api'
import { queryClient } from './query-client'

type AuthValue = {
  token: string
  login: (token: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState(readAdminToken)
  const logout = useCallback(() => {
    clearAdminToken()
    queryClient.clear()
    setToken('')
  }, [])
  const login = useCallback(async (value: string) => {
    await adminApi.verifySession(value)
    saveAdminToken(value)
    setToken(value)
  }, [])
  useEffect(() => {
    window.addEventListener(adminUnauthorizedEvent, logout)
    return () => window.removeEventListener(adminUnauthorizedEvent, logout)
  }, [logout])
  const value = useMemo(() => ({ token, login, logout }), [login, logout, token])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside AuthProvider')
  return value
}
