import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !key) {
  throw new Error('Заполните VITE_SUPABASE_URL и VITE_SUPABASE_ANON_KEY в файле .env')
}

export const supabase = createClient(url, key)
