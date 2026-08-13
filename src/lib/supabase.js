import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

export const isSupabaseConfigured = Boolean(
  supabaseUrl &&
    supabasePublishableKey &&
    !String(supabaseUrl).includes('YOUR_') &&
    !String(supabasePublishableKey).includes('YOUR_'),
)

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabasePublishableKey)
  : null

export async function signInWithGoogle() {
  if (!supabase) {
    throw new Error('Supabase 환경 변수가 설정되지 않았습니다.')
  }

  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin,
      queryParams: {
        access_type: 'offline',
        prompt: 'consent',
      },
    },
  })

  if (error) {
    const message = error.message || 'Google 로그인에 실패했습니다.'
    if (/provider is not enabled|Unsupported provider/i.test(message)) {
      throw new Error(
        'Supabase에서 Google provider가 아직 켜져 있지 않습니다. Dashboard → Authentication → Providers → Google 을 Enable 하고 Client ID/Secret을 저장해 주세요.',
      )
    }
    throw new Error(message)
  }
}

export async function signOut() {
  if (!supabase) {
    throw new Error('Supabase 환경 변수가 설정되지 않았습니다.')
  }

  const { error } = await supabase.auth.signOut()
  if (error) {
    throw new Error(error.message || '로그아웃에 실패했습니다.')
  }
}
