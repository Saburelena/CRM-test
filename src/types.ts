export type Role = 'manager' | 'executor'

export type TaskStatus = 'new' | 'in_progress' | 'review' | 'accepted' | 'rework'

export type Profile = {
  id: string
  email: string
  role: Role
}

export type WorkObject = {
  id: string
  name: string
  address: string
}

export function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

export const STATUS_LABEL: Record<TaskStatus, string> = {
  new: 'Новая',
  in_progress: 'В работе',
  review: 'На проверке',
  accepted: 'Принята',
  rework: 'На доработку',
}
