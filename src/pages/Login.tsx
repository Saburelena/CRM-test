import { useState } from 'react'
import type { SubmitEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase'

export default function Login() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  async function onSubmit(e: SubmitEvent) {
    e.preventDefault()
    setError('')
    const { error: signError } = await supabase.auth.signInWithPassword({ email, password })
    if (signError) {
      setError(signError.message === 'Invalid login credentials' ? 'Неверная почта или пароль' : signError.message)
      return
    }
    navigate('/objects')
  }

  return (
    <form onSubmit={onSubmit}>
      <h1>Вход</h1>
      {error && <p>{error}</p>}
      <label>
        Почта
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </label>
      <label>
        Пароль
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </label>
      <button type="submit">Войти</button>
    </form>
  )
}
