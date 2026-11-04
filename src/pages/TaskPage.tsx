import { useEffect, useState } from 'react'
import type { SubmitEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useProfile } from '../Layout'
import { supabase } from '../supabase'
import { one, STATUS_LABEL, type Profile, type TaskStatus } from '../types'

type TaskView = {
  id: string
  title: string
  description: string | null
  object_id: string
  status: TaskStatus
  author_id: string
  executor_id: string | null
  created_at: string
  object: { name: string } | null
  author: { email: string } | null
  executor: { email: string } | null
}

type HistoryRow = {
  id: string
  old_status: TaskStatus | null
  new_status: TaskStatus
  comment: string | null
  created_at: string
  changer: { email: string } | null
}

const TASK = `
  id, title, description, object_id, status, author_id, executor_id, created_at,
  object:objects(name),
  author:profiles!tasks_author_id_fkey(email),
  executor:profiles!tasks_executor_id_fkey(email)
`

const HISTORY = `
  id, old_status, new_status, comment, created_at,
  changer:profiles!task_history_changed_by_fkey(email)
`

export default function TaskPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const profile = useProfile()
  const [task, setTask] = useState<TaskView | null>(null)
  const [history, setHistory] = useState<HistoryRow[]>([])
  const [executors, setExecutors] = useState<Profile[]>([])
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [executorId, setExecutorId] = useState('')
  const [comment, setComment] = useState('')
  const [error, setError] = useState('')
  const [missing, setMissing] = useState(false)

  async function load() {
    if (!id) return
    const [taskRes, historyRes] = await Promise.all([
      supabase.from('tasks').select(TASK).eq('id', id).maybeSingle(),
      supabase.from('task_history').select(HISTORY).eq('task_id', id).order('created_at'),
    ])

    if (taskRes.error) {
      setError(taskRes.error.message)
      return
    }
    if (!taskRes.data) {
      setMissing(true)
      return
    }
    if (historyRes.error) {
      setError(historyRes.error.message)
      return
    }

    const raw = taskRes.data as unknown as Omit<TaskView, 'object' | 'author' | 'executor'> & {
      object: TaskView['object'] | NonNullable<TaskView['object']>[]
      author: TaskView['author'] | NonNullable<TaskView['author']>[]
      executor: TaskView['executor'] | NonNullable<TaskView['executor']>[]
    }
    const next: TaskView = {
      ...raw,
      object: one(raw.object),
      author: one(raw.author),
      executor: one(raw.executor),
    }
    setTask(next)
    setTitle(next.title)
    setDescription(next.description ?? '')
    setExecutorId(next.executor_id ?? '')
    setHistory(
      ((historyRes.data ?? []) as unknown as Array<Omit<HistoryRow, 'changer'> & { changer: HistoryRow['changer'] | NonNullable<HistoryRow['changer']>[] }>).map(
        (row) => ({ ...row, changer: one(row.changer) }),
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

  async function save(e: SubmitEvent) {
    e.preventDefault()
    if (!task) return
    setError('')
    const { error: saveError } = await supabase
      .from('tasks')
      .update({
        title: title.trim(),
        description: description.trim() || null,
        executor_id: executorId,
      })
      .eq('id', task.id)
    if (saveError) setError(saveError.message)
    else load()
  }

  async function remove() {
    if (!task || !confirm('Удалить задачу?')) return
    const objectId = task.object_id
    const { error: deleteError } = await supabase.from('tasks').delete().eq('id', task.id)
    if (deleteError) setError(deleteError.message)
    else navigate(`/objects/${objectId}`)
  }

  async function changeStatus(next: TaskStatus, needsComment = false) {
    if (!task) return
    if (needsComment && !comment.trim()) {
      setError('Напишите, что исправить')
      return
    }
    setError('')
    const { error: statusError } = await supabase.rpc('change_task_status', {
      p_task_id: task.id,
      p_status: next,
      p_comment: needsComment ? comment.trim() : null,
    })
    if (statusError) {
      setError(statusError.message)
      return
    }
    setComment('')
    load()
  }

  if (missing) return <p>Задача не найдена или нет доступа</p>
  if (!task) return <p>Загрузка...</p>

  const mine = task.executor_id === profile.id
  const showTake = profile.role === 'executor' && mine && (task.status === 'new' || task.status === 'rework')
  const showReview = profile.role === 'executor' && mine && task.status === 'in_progress'
  const showAccept = profile.role === 'manager' && task.status === 'review'

  return (
    <>
      <p>
        <Link to={`/objects/${task.object_id}`}>{task.object?.name ?? 'К объекту'}</Link>
      </p>
      <h1>{task.title}</h1>
      {error && <p className="error">{error}</p>}

      {profile.role === 'manager' ? (
        <form onSubmit={save}>
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
          <div className="actions">
            <button type="submit">Сохранить</button>
            <button type="button" onClick={remove}>
              Удалить
            </button>
          </div>
        </form>
      ) : (
        <p>{task.description || 'Без описания'}</p>
      )}

      <table>
        <tbody>
          <tr>
            <th>Статус</th>
            <td>{STATUS_LABEL[task.status]}</td>
          </tr>
          <tr>
            <th>Исполнитель</th>
            <td>{task.executor?.email ?? '—'}</td>
          </tr>
          <tr>
            <th>Автор</th>
            <td>{task.author?.email ?? '—'}</td>
          </tr>
          <tr>
            <th>Создана</th>
            <td>{new Date(task.created_at).toLocaleString('ru-RU')}</td>
          </tr>
        </tbody>
      </table>

      <div className="actions">
        {showTake && (
          <button type="button" onClick={() => changeStatus('in_progress')}>
            Взять в работу
          </button>
        )}
        {showReview && (
          <button type="button" onClick={() => changeStatus('review')}>
            На проверку
          </button>
        )}
        {showAccept && (
          <button type="button" onClick={() => changeStatus('accepted')}>
            Принять
          </button>
        )}
      </div>

      {showAccept && (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault()
            changeStatus('rework', true)
          }}
        >
          <label>
            Комментарий к доработке
            <textarea value={comment} onChange={(e) => setComment(e.target.value)} required />
          </label>
          <button type="submit">На доработку</button>
        </form>
      )}

      <h2>История</h2>
      <table>
        <thead>
          <tr>
            <th>Когда</th>
            <th>Кто</th>
            <th>Из</th>
            <th>В</th>
            <th>Комментарий</th>
          </tr>
        </thead>
        <tbody>
          {history.map((row) => (
            <tr key={row.id}>
              <td>{new Date(row.created_at).toLocaleString('ru-RU')}</td>
              <td>{row.changer?.email ?? '—'}</td>
              <td>{row.old_status ? STATUS_LABEL[row.old_status] : '—'}</td>
              <td>{STATUS_LABEL[row.new_status]}</td>
              <td>{row.comment ?? ''}</td>
            </tr>
          ))}
          {history.length === 0 && (
            <tr>
              <td colSpan={5}>Записей нет</td>
            </tr>
          )}
        </tbody>
      </table>
    </>
  )
}
