import { useEffect, useState } from 'react'
import type { SubmitEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useProfile } from '../Layout'
import { supabase } from '../supabase'
import { one, STATUS_LABEL, type Profile, type TaskStatus, type WorkObject } from '../types'

type TaskRow = {
  id: string
  title: string
  status: TaskStatus
  created_at: string
  executor: { email: string } | null
}

const TASKS = 'id, title, status, created_at, executor:profiles!tasks_executor_id_fkey(email)'

export default function ObjectPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const profile = useProfile()
  const [object, setObject] = useState<WorkObject | null>(null)
  const [tasks, setTasks] = useState<TaskRow[]>([])
  const [executors, setExecutors] = useState<Profile[]>([])
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [executorId, setExecutorId] = useState('')
  const [error, setError] = useState('')
  const [missing, setMissing] = useState(false)

  async function load() {
    if (!id) return
    const [objectRes, taskRes] = await Promise.all([
      supabase.from('objects').select('id, name, address').eq('id', id).maybeSingle(),
      supabase.from('tasks').select(TASKS).eq('object_id', id).order('created_at', { ascending: false }),
    ])

    if (objectRes.error) {
      setError(objectRes.error.message)
      return
    }
    if (!objectRes.data) {
      setMissing(true)
      return
    }
    if (taskRes.error) {
      setError(taskRes.error.message)
      return
    }

    setObject(objectRes.data)
    setName(objectRes.data.name)
    setAddress(objectRes.data.address)
    setTasks(
      ((taskRes.data ?? []) as unknown as Array<Omit<TaskRow, 'executor'> & { executor: TaskRow['executor'] | NonNullable<TaskRow['executor']>[] }>).map(
        (row) => ({ ...row, executor: one(row.executor) }),
      ),
    )
  }

  useEffect(() => {
    load()
    if (profile.role !== 'manager') return
    supabase
      .from('profiles')
      .select('id, email, role')
      .eq('role', 'executor')
      .order('email')
      .then(({ data, error: loadError }) => {
        if (loadError) setError(loadError.message)
        else setExecutors((data ?? []) as Profile[])
      })
  }, [id])

  async function saveObject(e: SubmitEvent) {
    e.preventDefault()
    if (!id) return
    setError('')
    const { error: saveError } = await supabase
      .from('objects')
      .update({ name: name.trim(), address: address.trim() })
      .eq('id', id)
    if (saveError) setError(saveError.message)
    else load()
  }

  async function removeObject() {
    if (!id || !confirm('Удалить объект вместе с задачами?')) return
    const { error: deleteError } = await supabase.from('objects').delete().eq('id', id)
    if (deleteError) setError(deleteError.message)
    else navigate('/objects')
  }

  async function createTask(e: SubmitEvent) {
    e.preventDefault()
    if (!id) return
    setError('')
    const { error: insertError } = await supabase.from('tasks').insert({
      object_id: id,
      title: title.trim(),
      description: description.trim() || null,
      executor_id: executorId,
      author_id: profile.id,
      status: 'new',
    })
    if (insertError) {
      setError(insertError.message)
      return
    }
    setTitle('')
    setDescription('')
    setExecutorId('')
    load()
  }

  if (missing) return <p>Объект не найден или нет доступа</p>
  if (!object) return <p>Загрузка...</p>

  return (
    <>
      <p>
        <Link to="/objects">К объектам</Link>
      </p>
      <h1>{object.name}</h1>
      {error && <p className="error">{error}</p>}

      {profile.role === 'manager' ? (
        <form onSubmit={saveObject}>
          <label>
            Название
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label>
            Адрес
            <input value={address} onChange={(e) => setAddress(e.target.value)} required />
          </label>
          <div className="actions">
            <button type="submit">Сохранить</button>
            <button type="button" onClick={removeObject}>
              Удалить
            </button>
          </div>
        </form>
      ) : (
        <p>{object.address}</p>
      )}

      <h2>Задачи</h2>
      <table>
        <thead>
          <tr>
            <th>Название</th>
            <th>Статус</th>
            <th>Исполнитель</th>
            <th>Создана</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((task) => (
            <tr key={task.id}>
              <td>{task.title}</td>
              <td>{STATUS_LABEL[task.status]}</td>
              <td>{task.executor?.email ?? '—'}</td>
              <td>{new Date(task.created_at).toLocaleString('ru-RU')}</td>
              <td>
                <Link to={`/tasks/${task.id}`}>Открыть</Link>
              </td>
            </tr>
          ))}
          {tasks.length === 0 && (
            <tr>
              <td colSpan={5}>Задач нет</td>
            </tr>
          )}
        </tbody>
      </table>

      {profile.role === 'manager' && (
        <form onSubmit={createTask}>
          <h2>Новая задача</h2>
          <label>
            Название
            <input value={title} onChange={(e) => setTitle(e.target.value)} required />
          </label>
          <label>
            Описание
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
          <label>
            Исполнитель
            <select value={executorId} onChange={(e) => setExecutorId(e.target.value)} required>
              <option value="">Выберите</option>
              {executors.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.email}
                </option>
              ))}
            </select>
          </label>
          <button type="submit">Создать задачу</button>
        </form>
      )}
    </>
  )
}
