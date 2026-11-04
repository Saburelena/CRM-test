import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { Link, Navigate, Outlet, useNavigate, useOutletContext } from 'react-router-dom'
import { supabase } from './supabase'
import type { Profile } from './types'

export function useProfile() {
  return useOutletContext<Profile>()
}

export default function Layout() {
  const navigate = useNavigate()
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setReady(true)
    })

    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      setReady(true)
    })

    return () => data.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) {
      setProfile(null)
      return
    }

    let ignore = false
    supabase
      .from('profiles')
      .select('id, email, role')
      .eq('id', session.user.id)
      .single()
      .then(({ data, error: profileError }) => {
        if (ignore) return
        if (profileError) {
          setError(profileError.message)
          setProfile(null)
          return
        }
        setError('')
        setProfile(data as Profile)
      })

    return () => {
      ignore = true
    }
  }, [session])

  async function logout() {
    await supabase.auth.signOut()
    navigate('/login')
  }

  if (!ready) return <p className="pad">Загрузка...</p>
  if (!session) return <Navigate to="/login" replace />
  if (error) return <p className="pad error">{error}</p>
  if (!profile) return <p className="pad">Загрузка...</p>

  const roleLabel = profile.role === 'manager' ? 'постановщик' : 'исполнитель'

  return (
    <>
      <header>
        <strong>Мини-CRM</strong>
        <nav>
          <Link to="/objects">Объекты</Link>
          {profile.role === 'executor' && <Link to="/my">Мои задачи</Link>}
        </nav>
        <span className="who">
          {profile.email}, {roleLabel}
        </span>
        <button type="button" onClick={logout}>
          Выйти
        </button>
      </header>
      <main>
        <Outlet context={profile} />
      </main>
    </>
  )
}
