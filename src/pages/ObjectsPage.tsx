import { useEffect, useState } from 'react'
import type { SubmitEvent } from 'react'
import { Link } from 'react-router-dom'
import { useProfile } from '../Layout'
import { supabase } from '../supabase'
import type { WorkObject } from '../types'

export default function ObjectsPage() {
  const profile = useProfile()
  const [rows, setRows] = useState<WorkObject[]>([])
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [error, setError] = useState('')

  async function load() {
    const { data, error: loadError } = await supabase.from('objects').select('id, name, address').order('name')
    if (loadError) setError(loadError.message)
    else setRows(data ?? [])
  }

  useEffect(() => {
    load()
  }, [])

  async function create(e: SubmitEvent) {
    e.preventDefault()
    setError('')
    const { error: insertError } = await supabase.from('objects').insert({
      name: name.trim(),
      address: address.trim(),
    })
    if (insertError) {
      setError(insertError.message)
      return
    }
    setName('')
    setAddress('')
    load()
  }

  return (
    <>
      <h1>Объекты</h1>
      {profile.role === 'manager' && (
        <form className="row" onSubmit={create}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Название" required />
          <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Адрес" required />
          <button type="submit">Создать</button>
        </form>
      )}
      {error && <p className="error">{error}</p>}
      <table>
        <thead>
          <tr>
            <th>Название</th>
            <th>Адрес</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{row.name}</td>
              <td>{row.address}</td>
              <td>
                <Link to={`/objects/${row.id}`}>Открыть</Link>
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={3}>Объектов нет</td>
            </tr>
          )}
        </tbody>
      </table>
    </>
  )
}
