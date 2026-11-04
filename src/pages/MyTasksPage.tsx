import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useProfile } from '../Layout'
import { supabase } from '../supabase'
import { one, STATUS_LABEL, type TaskStatus } from '../types'

type Row = {
  id: string
  title: string
  status: TaskStatus
  created_at: string
  object: { id: string; name: string } | null
}

export default function MyTasksPage() {
  const profile = useProfile()
  const [rows, setRows] = useState<Row[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    if (profile.role !== 'executor') return
    supabase
      .from('tasks')
      .select('id, title, status, created_at, object:objects(id, name)')
      .eq('executor_id', profile.id)
      .order('created_at', { ascending: false })
      .then(({ data, error: loadError }) => {
        if (loadError) setError(loadError.message)
        else {
          setRows(
            ((data ?? []) as unknown as Array<Omit<Row, 'object'> & { object: Row['object'] | NonNullable<Row['object']>[] }>).map((row) => ({
              ...row,
              object: one(row.object),
            })),
          )
        }
      })
  }, [profile.id, profile.role])

  if (profile.role !== 'executor') return <Navigate to="/objects" replace />

  return (
    <>
      <h1>Мои задачи</h1>
      {error && <p className="error">{error}</p>}
      <table>
        <thead>
          <tr>
            <th>Задача</th>
            <th>Объект</th>
            <th>Статус</th>
            <th>Создана</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{row.title}</td>
              <td>{row.object ? <Link to={`/objects/${row.object.id}`}>{row.object.name}</Link> : '—'}</td>
              <td>{STATUS_LABEL[row.status]}</td>
              <td>{new Date(row.created_at).toLocaleString('ru-RU')}</td>
              <td>
                <Link to={`/tasks/${row.id}`}>Открыть</Link>
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={5}>Задач нет</td>
            </tr>
          )}
        </tbody>
      </table>
    </>
  )
}
