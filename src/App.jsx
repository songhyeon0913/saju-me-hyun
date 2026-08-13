import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { buildSajuPrompt } from './prompt'
import { signInWithGoogle, signOut, supabase, isSupabaseConfigured } from './lib/supabase'
import mascotCrystal from './assets/mascot/crystal.png'
import mascotScholar from './assets/mascot/scholar.png'
import mascotWriter from './assets/mascot/writer.png'
import mascotWave from './assets/mascot/wave.png'
import './App.css'

const USER_FIELDS = 'id, name, birth_date, birth_time, gender, calendar_type, created_at, updated_at'
const READING_FIELDS =
  'id, user_id, result, share_token, is_shared, created_at, users(name, birth_date, birth_time, gender, calendar_type)'

function emptyProfileForm() {
  return {
    name: '',
    birthDate: '',
    birthTime: '',
    gender: '',
    calendarType: 'solar',
  }
}

function profileToForm(profile) {
  if (!profile) return emptyProfileForm()
  return {
    name: profile.name ?? '',
    birthDate: profile.birth_date ?? '',
    birthTime: profile.birth_time ? String(profile.birth_time).slice(0, 5) : '',
    gender: profile.gender ?? '',
    calendarType: profile.calendar_type ?? 'solar',
  }
}

function formToProfilePayload(form) {
  return {
    name: form.name.trim(),
    birth_date: form.birthDate,
    birth_time: form.birthTime || null,
    gender: form.gender,
    calendar_type: form.calendarType,
    updated_at: new Date().toISOString(),
  }
}

function formatBirthMeta(source) {
  if (!source?.birth_date && !source?.birthDate) return ''

  const date = source.birth_date || source.birthDate
  const rawTime = source.birth_time || source.birthTime
  const time = rawTime ? String(rawTime).slice(0, 5) : null
  const calendarType = source.calendar_type || source.calendarType
  const calendar = calendarType === 'lunar' ? '음력' : '양력'
  const genderValue = source.gender
  const genderLabel =
    genderValue === 'female' ? '여성' : genderValue === 'male' ? '남성' : null

  return [date, time, calendar, genderLabel].filter(Boolean).join(' · ')
}

function formatShortDate(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function getUserLabel(user) {
  return user?.email || user?.user_metadata?.full_name || user?.user_metadata?.name || '사용자'
}

function isProfileFormValid(form) {
  return Boolean(form.name.trim() && form.birthDate && form.gender)
}

function formatAuthError(message = '') {
  if (/issued at future|issued in the future|device clock|clock skew/i.test(message)) {
    return '기기 시간이 서버보다 느려 로그인이 막혔습니다. Windows 설정 → 시간 및 언어 → “지금 동기화” 후 다시 로그인해 주세요.'
  }
  return message
}

async function fetchSajuReading(form) {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY
  if (!apiKey) {
    throw new Error(
      'VITE_GEMINI_API_KEY가 없습니다. .env 에 키를 넣고 개발 서버를 다시 시작해 주세요.',
    )
  }

  const prompt = buildSajuPrompt(form)
  const url = `https://generativelanguage.googleapis.com/v1beta/interactions?key=${apiKey}`

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gemini-3.6-flash',
      input: prompt,
    }),
  })

  const data = await res.json()
  if (!res.ok) {
    throw new Error(data?.error?.message || `요청 실패 (${res.status})`)
  }

  const textFromSteps = data?.steps
    ?.flatMap((step) => step.content || [])
    ?.filter((part) => part.type === 'text' && part.text)
    ?.map((part) => part.text)
    ?.join('')
    ?.trim()

  const text = (data?.output_text || textFromSteps || '').trim()
  if (!text) {
    throw new Error('모델 응답이 비어 있습니다. 잠시 후 다시 시도해 주세요.')
  }

  return text
}

async function loadUserProfile(userId) {
  const { data, error } = await supabase
    .from('users')
    .select(USER_FIELDS)
    .eq('id', userId)
    .maybeSingle()

  if (error) {
    throw new Error(error.message || '프로필을 불러오지 못했습니다.')
  }

  return data
}

async function upsertUserProfile(userId, form) {
  const { error } = await supabase.from('users').upsert(
    {
      id: userId,
      ...formToProfilePayload(form),
    },
    { onConflict: 'id' },
  )

  if (error) {
    throw new Error(error.message || '프로필 저장에 실패했습니다.')
  }

  const data = await loadUserProfile(userId)
  if (!data) {
    throw new Error('프로필이 저장되었지만 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.')
  }

  return data
}

async function enableReadingShare(readingId) {
  const { data, error } = await supabase.rpc('enable_saju_share', {
    p_reading_id: readingId,
  })

  if (error) {
    throw new Error(error.message || '공유 링크를 만들지 못했습니다.')
  }

  return data
}

async function shareResultLink(url, title) {
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({ title, text: title, url })
      return 'shared'
    } catch (err) {
      if (err?.name === 'AbortError') return 'cancelled'
    }
  }

  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(url)
    return 'copied'
  }

  window.prompt('아래 링크를 복사하세요', url)
  return 'prompted'
}

async function createSajuReading(userId, resultText) {
  const { data, error } = await supabase
    .from('saju_readings')
    .insert({
      user_id: userId,
      result: resultText,
    })
    .select(READING_FIELDS)
    .single()

  if (error) {
    throw new Error(error.message || '사주 결과 저장에 실패했습니다.')
  }

  return data
}

async function updateSajuReading(id, resultText) {
  const { data, error } = await supabase
    .from('saju_readings')
    .update({ result: resultText })
    .eq('id', id)
    .select(READING_FIELDS)
    .single()

  if (error) {
    throw new Error(error.message || '사주 기록 수정에 실패했습니다.')
  }

  return data
}

async function deleteSajuReading(id) {
  const { error } = await supabase.from('saju_readings').delete().eq('id', id)
  if (error) {
    throw new Error(error.message || '사주 기록 삭제에 실패했습니다.')
  }
}

async function loadSajuReadings() {
  const { data, error } = await supabase
    .from('saju_readings')
    .select(READING_FIELDS)
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error(error.message || '저장된 사주 목록을 불러오지 못했습니다.')
  }

  return data ?? []
}

function ProfileFields({ form, onChange, disabled, idPrefix = 'profile' }) {
  const setField = (key, value) => onChange({ ...form, [key]: value })

  return (
    <div className="form profile-fields">
      <label className="field">
        <span className="field-label">이름</span>
        <input
          id={`${idPrefix}-name`}
          type="text"
          placeholder="예: 홍길동"
          value={form.name}
          onChange={(e) => setField('name', e.target.value)}
          required
          autoComplete="name"
          disabled={disabled}
        />
      </label>

      <div className="row">
        <label className="field">
          <span className="field-label">생년월일</span>
          <input
            type="date"
            value={form.birthDate}
            onChange={(e) => setField('birthDate', e.target.value)}
            required
            disabled={disabled}
          />
        </label>

        <label className="field">
          <span className="field-label">
            태어난 시간
            <span className="field-optional">선택</span>
          </span>
          <input
            type="time"
            value={form.birthTime}
            onChange={(e) => setField('birthTime', e.target.value)}
            disabled={disabled}
          />
          <span className="field-hint">모르면 비워 두셔도 됩니다</span>
        </label>
      </div>

      <div className="row">
        <label className="field">
          <span className="field-label">성별</span>
          <select
            value={form.gender}
            onChange={(e) => setField('gender', e.target.value)}
            required
            disabled={disabled}
          >
            <option value="">선택하세요</option>
            <option value="male">남성</option>
            <option value="female">여성</option>
          </select>
        </label>

        <fieldset className="field calendar" disabled={disabled}>
          <legend className="field-label">양력 / 음력</legend>
          <div className="segment">
            <label>
              <input
                type="radio"
                name={`${idPrefix}-calendarType`}
                value="solar"
                checked={form.calendarType === 'solar'}
                onChange={(e) => setField('calendarType', e.target.value)}
              />
              양력
            </label>
            <label>
              <input
                type="radio"
                name={`${idPrefix}-calendarType`}
                value="lunar"
                checked={form.calendarType === 'lunar'}
                onChange={(e) => setField('calendarType', e.target.value)}
              />
              음력
            </label>
          </div>
        </fieldset>
      </div>
    </div>
  )
}

function App() {
  const [user, setUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [authBusy, setAuthBusy] = useState(false)
  const [authError, setAuthError] = useState('')

  const [profile, setProfile] = useState(null)
  const [profileStatus, setProfileStatus] = useState('idle')
  const [profileForm, setProfileForm] = useState(emptyProfileForm())
  const [showProfileModal, setShowProfileModal] = useState(false)
  const [profileModalMode, setProfileModalMode] = useState('onboarding')
  const [profileError, setProfileError] = useState('')
  const [dataError, setDataError] = useState('')

  const [result, setResult] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [readings, setReadings] = useState([])
  const [selectedReading, setSelectedReading] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [listError, setListError] = useState('')
  const [listLoading, setListLoading] = useState(false)
  const [toast, setToast] = useState(null)
  const [shareBusy, setShareBusy] = useState(false)

  const resultRef = useRef(null)
  const formTopRef = useRef(null)
  const toastTimerRef = useRef(null)
  const dataLoadIdRef = useRef(0)

  const busy = loading || saving
  const canSubmit = isProfileFormValid(profileForm) && !busy
  const selectedId = selectedReading?.id ?? null
  const isEditing = Boolean(editingId)
  const isViewing = Boolean(selectedReading && result && !loading && !isEditing)
  const profileLoading = profileStatus === 'loading'
  const needsOnboarding = Boolean(user && profileStatus === 'missing')
  const profileSource = selectedReading?.users || profile || profileForm
  const resultTitle = profileSource?.name
    ? `${profileSource.name}님의 사주`
    : '분석 결과'
  const resultMeta = formatBirthMeta(profileSource)
  const userLabel = getUserLabel(user)

  const loadUserData = async (userId) => {
    const loadId = ++dataLoadIdRef.current
    setProfileStatus('loading')
    setListLoading(true)
    setDataError('')

    try {
      const [nextProfile, rows] = await Promise.all([
        loadUserProfile(userId),
        loadSajuReadings(),
      ])

      if (loadId !== dataLoadIdRef.current) return

      setProfile(nextProfile)
      setProfileForm(profileToForm(nextProfile))
      setReadings(rows)
      setListError('')

      if (!nextProfile) {
        setProfileStatus('missing')
        setProfileModalMode('onboarding')
        setShowProfileModal(true)
      } else {
        setProfileStatus('ready')
        setShowProfileModal(false)
      }
    } catch (err) {
      if (loadId !== dataLoadIdRef.current) return
      const message = formatAuthError(err?.message || '데이터를 불러오지 못했습니다.')
      setProfileStatus('error')
      setListError(message)
      setDataError(message)
      setAuthError(message)
      setShowProfileModal(false)
    } finally {
      if (loadId === dataLoadIdRef.current) {
        setListLoading(false)
      }
    }
  }

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) {
      setAuthLoading(false)
      setUser(null)
      return
    }

    let cancelled = false
    setAuthBusy(false)

    ;(async () => {
      const { data, error: sessionError } = await supabase.auth.getSession()
      if (cancelled) return

      if (sessionError) {
        setAuthError(formatAuthError(sessionError.message))
        setUser(null)
      } else {
        setUser(data.session?.user ?? null)
      }
      setAuthLoading(false)
    })()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      setAuthLoading(false)
      setAuthBusy(false)
    })

    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!user) {
      setProfile(null)
      setProfileStatus('idle')
      setProfileForm(emptyProfileForm())
      setShowProfileModal(false)
      setReadings([])
      setSelectedReading(null)
      setEditingId(null)
      setResult('')
      setListError('')
      setListLoading(false)
      setDataError('')
      return
    }

    let cancelled = false

    ;(async () => {
      await loadUserData(user.id)
      if (cancelled) return
    })()

    return () => {
      cancelled = true
    }
  }, [user])
  useEffect(() => {
    if (!result || !resultRef.current || isEditing) return
    resultRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [selectedId, result, isEditing])

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        toastTimerRef.current.forEach((id) => clearTimeout(id))
      }
    }
  }, [])

  const showToast = (message) => {
    if (toastTimerRef.current) {
      toastTimerRef.current.forEach((id) => clearTimeout(id))
    }

    setToast({ id: Date.now(), message, leaving: false })

    const hideId = setTimeout(() => {
      setToast((prev) => (prev ? { ...prev, leaving: true } : null))
    }, 2000)

    const removeId = setTimeout(() => {
      setToast(null)
      toastTimerRef.current = null
    }, 2300)

    toastTimerRef.current = [hideId, removeId]
  }

  const handleGoogleLogin = async () => {
    setAuthBusy(true)
    setAuthError('')
    try {
      await signInWithGoogle()
    } catch (err) {
      setAuthError(formatAuthError(err?.message || 'Google 로그인에 실패했습니다.'))
      setAuthBusy(false)
    }
  }

  const handleSignOut = async () => {
    setAuthBusy(true)
    setAuthError('')
    setDataError('')
    try {
      await signOut()
      handleNewSaju({ silent: true })
    } catch (err) {
      setAuthError(formatAuthError(err?.message || '로그아웃에 실패했습니다.'))
    } finally {
      setAuthBusy(false)
    }
  }

  const openProfileEditor = () => {
    setProfileForm(profileToForm(profile))
    setProfileModalMode(profile ? 'edit' : 'onboarding')
    setProfileError('')
    setShowProfileModal(true)
  }

  const closeProfileModal = () => {
    setShowProfileModal(false)
    setProfileError('')
    setProfileForm(profileToForm(profile))
  }

  const handleSaveProfile = async (e) => {
    e?.preventDefault?.()
    if (!user || !isProfileFormValid(profileForm) || saving) return

    setSaving(true)
    setProfileError('')

    try {
      const saved = await upsertUserProfile(user.id, profileForm)
      // 저장 직후 진행 중이던 프로필 로딩이 모달을 다시 열지 않도록 무효화
      dataLoadIdRef.current += 1
      setListLoading(false)
      setProfile(saved)
      setProfileForm(profileToForm(saved))
      setProfileStatus('ready')
      setDataError('')
      setProfileError('')
      setShowProfileModal(false)
    } catch (err) {
      setProfileError(formatAuthError(err?.message || '프로필 저장 중 오류가 발생했습니다.'))
    } finally {
      setSaving(false)
    }
  }

  const handleShareResult = async () => {
    if (!selectedReading?.id || shareBusy) return

    setShareBusy(true)
    setError('')

    try {
      let token = selectedReading.share_token
      if (!selectedReading.is_shared || !token) {
        token = await enableReadingShare(selectedReading.id)
        const updated = {
          ...selectedReading,
          share_token: token,
          is_shared: true,
        }
        setSelectedReading(updated)
        replaceReadingInList(updated)
      }

      const url = `${window.location.origin}/result/${token}`
      const title = resultTitle
      const mode = await shareResultLink(url, title)
      if (mode === 'copied' || mode === 'prompted') {
        showToast('공유 링크를 복사했어요')
      } else if (mode === 'shared') {
        showToast('공유했어요')
      }
    } catch (err) {
      setError(err?.message || '공유 링크를 만들지 못했습니다.')
    } finally {
      setShareBusy(false)
    }
  }

  const handleSelectReading = (reading) => {
    setEditingId(null)
    setSelectedReading(reading)
    setResult(reading.result)
    setError('')
    if (profile) setProfileForm(profileToForm(profile))
  }

  const handleNewSaju = (options = {}) => {
    const silent = options?.silent === true
    const alreadyOnNewSaju =
      !selectedReading && !result && !editingId && !loading && !isViewing

    if (alreadyOnNewSaju) {
      if (!silent) {
        showToast('이미 새 사주 화면이 열려 있어요')
        formTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
      return
    }

    setResult('')
    setSelectedReading(null)
    setEditingId(null)
    setError('')
    if (profile) setProfileForm(profileToForm(profile))
    if (!silent) showToast('새 사주 화면으로 이동했어요')
    window.scrollTo({ top: 0, behavior: 'smooth' })
    requestAnimationFrame(() => {
      formTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  const handleStartEdit = () => {
    if (!selectedReading || !profile) return
    setProfileForm(profileToForm(profile))
    setEditingId(selectedReading.id)
    setError('')
    requestAnimationFrame(() => {
      formTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  const handleCancelEdit = () => {
    setEditingId(null)
    if (selectedReading) setResult(selectedReading.result)
    if (profile) setProfileForm(profileToForm(profile))
    setError('')
  }

  const replaceReadingInList = (saved) => {
    setReadings((prev) => {
      const next = prev.filter((row) => row.id !== saved.id)
      return [saved, ...next]
    })
  }

  const handleDelete = async () => {
    if (!selectedReading || busy) return

    const label = selectedReading.users?.name || profile?.name || '이'
    const ok = window.confirm(
      `"${label}" 사주 기록을 삭제할까요? 이 작업은 되돌릴 수 없습니다.`,
    )
    if (!ok) return

    setSaving(true)
    setError('')

    try {
      await deleteSajuReading(selectedReading.id)
      setReadings((prev) => prev.filter((row) => row.id !== selectedReading.id))
      handleNewSaju({ silent: true })
    } catch (err) {
      setError(err?.message || '사주 기록 삭제 중 오류가 발생했습니다.')
    } finally {
      setSaving(false)
    }
  }

  const handleAnalyze = async (e) => {
    e.preventDefault()
    if (!canSubmit || !user) return

    setLoading(true)
    setError('')
    if (!isEditing) {
      setResult('')
      setSelectedReading(null)
    }

    try {
      const savedProfile = await upsertUserProfile(user.id, profileForm)
      dataLoadIdRef.current += 1
      setProfile(savedProfile)
      setProfileForm(profileToForm(savedProfile))
      setProfileStatus('ready')
      setShowProfileModal(false)

      const text = await fetchSajuReading(profileForm)
      const saved = isEditing
        ? await updateSajuReading(editingId, text)
        : await createSajuReading(user.id, text)

      setResult(text)
      setSelectedReading(saved)
      setEditingId(null)
      replaceReadingInList(saved)
    } catch (err) {
      setError(err?.message || '사주 분석 중 오류가 발생했습니다.')
    } finally {
      setLoading(false)
    }
  }

  if (authLoading) {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <p className="brand-eyebrow">四柱命理</p>
          <h1>사주 미</h1>
          <p className="auth-lead">로그인 상태를 확인하는 중입니다…</p>
        </div>
      </div>
    )
  }

  if (!isSupabaseConfigured || !supabase) {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <p className="brand-eyebrow">四柱命理</p>
          <h1>사주 미</h1>
          <p className="auth-lead">`.env`에 Supabase 값이 없어 앱을 시작할 수 없습니다.</p>
          <p className="auth-hint">
            <code>VITE_SUPABASE_URL</code>, <code>VITE_SUPABASE_PUBLISHABLE_KEY</code>,
            <br />
            <code>VITE_GEMINI_API_KEY</code> 를 넣고 개발 서버를 다시 시작해 주세요.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="layout">
      <aside className="sidebar" aria-label="저장된 사주 목록">
        {user ? (
          <div className="auth-user">
            <div className="auth-user-copy">
              <p className="auth-user-label">내 이메일</p>
              <p className="auth-user-name" title={user.email || userLabel}>
                {user.email || userLabel}
              </p>
              {profile?.name ? (
                <p className="auth-user-profile-name">{profile.name}</p>
              ) : (
                <p className="auth-user-profile-name is-empty">프로필 미등록</p>
              )}
            </div>
            <div className="auth-user-actions">
              <button
                type="button"
                className="action-btn"
                onClick={openProfileEditor}
                disabled={authBusy || profileLoading}
              >
                프로필
              </button>
              <button
                type="button"
                className="action-btn"
                onClick={handleSignOut}
                disabled={authBusy}
              >
                로그아웃
              </button>
            </div>
          </div>
        ) : (
          <div className="auth-guest">
            <img
              className="mascot mascot-wave"
              src={mascotWave}
              alt="손 흔드는 사주 미 마스코트"
            />
            <button
              type="button"
              className="google-login"
              onClick={handleGoogleLogin}
              disabled={authBusy}
            >
              {authBusy ? 'Google로 이동 중…' : 'Google로 로그인'}
            </button>
            {authError ? <p className="auth-error">{authError}</p> : null}
            <p className="auth-hint">로그인하면 사주 정보를 저장할 수 있어요</p>
          </div>
        )}

        <button
          type="button"
          className="new-saju"
          onClick={() => handleNewSaju()}
        >
          + 새 사주 보기
        </button>

        <div className="sidebar-archive">
          <div className="sidebar-heading">
            <p className="sidebar-eyebrow">命錄</p>
            <div className="sidebar-heading-row">
              <h2 className="sidebar-title">분석 기록</h2>
              {user && !listLoading && !listError ? (
                <span className="sidebar-count">{readings.length}건</span>
              ) : null}
            </div>
            <p className="sidebar-lead">
              {user
                ? '이전에 본 사주 결과를 다시 열어보세요'
                : '로그인 후 내 사주 기록을 볼 수 있어요'}
            </p>
          </div>

          {!user ? (
            <p className="sidebar-empty">로그인하면 분석 기록이 여기에 표시됩니다.</p>
          ) : null}
          {user && profileLoading ? <p className="sidebar-empty">프로필 확인 중…</p> : null}
          {user && listLoading ? <p className="sidebar-empty">목록을 불러오는 중…</p> : null}
          {user && listError ? <p className="sidebar-error">{listError}</p> : null}
          {user && !listLoading && !listError && readings.length === 0 ? (
            <p className="sidebar-empty">아직 분석 기록이 없습니다.</p>
          ) : null}

          {user ? (
            <ul className="sidebar-list">
              {readings.map((reading) => {
                const readingName = reading.users?.name || profile?.name || '사주'
                const initial = readingName.trim().slice(0, 1) || '?'
                return (
                  <li key={reading.id}>
                    <button
                      type="button"
                      className={`sidebar-item${selectedId === reading.id ? ' is-active' : ''}`}
                      onClick={() => handleSelectReading(reading)}
                    >
                      <span className="sidebar-item-mark" aria-hidden="true">
                        {initial}
                      </span>
                      <span className="sidebar-item-copy">
                        <span className="sidebar-item-name">{readingName}</span>
                        <span className="sidebar-item-meta">
                          {formatShortDate(reading.created_at)}
                        </span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          ) : null}
        </div>
      </aside>

      <main className="page">
        <div className={`panel${isViewing ? ' is-viewing' : ''}`}>
          {dataError ? (
            <div className="error" role="alert">
              <p className="error-title">로그인 세션에 문제가 있어요</p>
              <p>{dataError}</p>
              <div className="form-actions">
                <button
                  type="button"
                  className="action-btn"
                  onClick={() => user && loadUserData(user.id)}
                  disabled={profileLoading}
                >
                  다시 시도
                </button>
                <button
                  type="button"
                  className="action-btn"
                  onClick={openProfileEditor}
                  disabled={profileLoading}
                >
                  프로필 등록
                </button>
                <button
                  type="button"
                  className="error-retry"
                  onClick={handleSignOut}
                  disabled={authBusy}
                >
                  로그아웃 후 다시 로그인
                </button>
              </div>
            </div>
          ) : null}

          <header className="brand" ref={formTopRef}>
            <p className="brand-eyebrow">四柱命理</p>
            <h1>사주 미</h1>
            {isViewing ? (
              <>
                <p className="brand-lead">저장된 사주 결과를 보고 있습니다</p>
                <p className="preview">{resultTitle}</p>
              </>
            ) : isEditing ? (
              <>
                <p className="brand-lead">프로필 정보로 사주를 다시 분석합니다</p>
                <p className={`preview${profileForm.name.trim() ? '' : ' is-empty'}`}>
                  {profileForm.name.trim() || 'OOO'}님의 사주
                </p>
              </>
            ) : (
              <>
                <p className="brand-lead">
                  {profile
                    ? '저장된 프로필로 바로 사주를 볼 수 있어요'
                    : '사주 보기 전, 기본 정보를 입력해주세요'}
                </p>
                <p className={`preview${profileForm.name.trim() ? '' : ' is-empty'}`}>
                  {profileForm.name.trim() || 'OOO'}님의 사주
                </p>
              </>
            )}
          </header>

          {!isViewing ? (
            <div className="form-stage">
              <form className="form" onSubmit={handleAnalyze}>
              <ProfileFields
                form={profileForm}
                onChange={setProfileForm}
                disabled={busy || profileLoading}
                idPrefix="main"
              />

              {isEditing ? (
                <div className="form-actions">
                  <button type="submit" className="submit" disabled={!canSubmit || !user}>
                    {loading ? '다시 풀이 중…' : '다시 분석하고 저장'}
                  </button>
                  <button
                    type="button"
                    className="action-btn"
                    disabled={busy}
                    onClick={handleCancelEdit}
                  >
                    수정 취소
                  </button>
                </div>
              ) : user ? (
                <div className="form-actions">
                  <button
                    type="submit"
                    className="submit"
                    disabled={!canSubmit || needsOnboarding || profileStatus === 'error'}
                  >
                    {loading ? '사주 풀이 중…' : '내 사주 보기'}
                  </button>
                  <button
                    type="button"
                    className="submit submit-secondary"
                    disabled={
                      !canSubmit || needsOnboarding || saving || profileStatus === 'error'
                    }
                    onClick={handleSaveProfile}
                  >
                    {saving ? '저장 중…' : '프로필만 저장'}
                  </button>
                </div>
              ) : (
                <div className="login-required">
                  <p className="login-required-text">
                    사주 분석을 저장하려면 Google 로그인이 필요합니다.
                  </p>
                  <button
                    type="button"
                    className="google-login"
                    onClick={handleGoogleLogin}
                    disabled={authBusy}
                  >
                    {authBusy ? 'Google로 이동 중…' : 'Google로 로그인'}
                  </button>
                  {authError ? <p className="auth-error">{authError}</p> : null}
                </div>
              )}
              </form>
            </div>
          ) : null}

          {loading ? (
            <div className="loading-panel" aria-live="polite">
              <img
                className="mascot mascot-crystal"
                src={mascotCrystal}
                alt="수정구슬을 보는 마스코트"
              />
              <div className="loading-spinner" aria-hidden="true" />
              <p className="loading-title">사주 풀이 중</p>
              <p className="loading-desc">
                저장된 생년월일시를 바탕으로 사주 원국을 구성하고,
                <br />
                성격·기질·재능을 자세히 읽어 가는 중입니다.
              </p>
              <p className="loading-hint">잠시만 기다려 주세요. 보통 몇 초 정도 걸려요.</p>
            </div>
          ) : null}

          {error ? (
            <div className="error" role="alert">
              <p className="error-title">요청을 완료하지 못했습니다</p>
              <p>{error}</p>
              {!isEditing ? (
                <button
                  type="button"
                  className="error-retry"
                  onClick={() => handleNewSaju()}
                >
                  처음으로 돌아가기
                </button>
              ) : null}
            </div>
          ) : null}

          {result && !loading && !isEditing ? (
            <section
              key={selectedId || 'latest'}
              ref={resultRef}
              className="result"
              aria-live="polite"
            >
              <header className="result-header">
                <img
                  className="mascot mascot-crystal-result"
                  src={mascotCrystal}
                  alt=""
                  aria-hidden="true"
                />
                <div className="result-header-top">
                  <p className="result-eyebrow">四柱命理 · 분석 결과</p>
                  <div className="result-actions">
                    <button
                      type="button"
                      className="action-btn action-btn-share"
                      onClick={handleShareResult}
                      disabled={busy || shareBusy || !selectedReading?.id}
                    >
                      {shareBusy ? '링크 만드는 중…' : '공유하기'}
                    </button>
                    <button
                      type="button"
                      className="action-btn"
                      onClick={handleStartEdit}
                      disabled={busy}
                    >
                      다시 분석
                    </button>
                    <button
                      type="button"
                      className="action-btn action-btn-danger"
                      onClick={handleDelete}
                      disabled={busy}
                    >
                      삭제
                    </button>
                    <button
                      type="button"
                      className="new-saju new-saju-inline"
                      onClick={() => handleNewSaju()}
                    >
                      + 새 사주 보기
                    </button>
                  </div>
                </div>
                <h2 className="result-heading">{resultTitle}</h2>
                {resultMeta ? <p className="result-meta">{resultMeta}</p> : null}
              </header>
              <div className="result-body markdown">
                <ReactMarkdown>{result}</ReactMarkdown>
              </div>
              <footer className="result-footer">
                <div className="result-footer-actions">
                  <button
                    type="button"
                    className="action-btn action-btn-share"
                    onClick={handleShareResult}
                    disabled={busy || shareBusy || !selectedReading?.id}
                  >
                    {shareBusy ? '링크 만드는 중…' : '공유하기'}
                  </button>
                  <button
                    type="button"
                    className="action-btn"
                    onClick={openProfileEditor}
                    disabled={busy}
                  >
                    프로필 수정
                  </button>
                  <button
                    type="button"
                    className="new-saju"
                    onClick={() => handleNewSaju()}
                  >
                    + 새 사주 보기
                  </button>
                </div>
              </footer>
            </section>
          ) : null}
        </div>
      </main>

      {showProfileModal ? (
        <div className="modal-backdrop" role="presentation">
          <div
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="profile-modal-title"
          >
            <button
              type="button"
              className="modal-close"
              onClick={closeProfileModal}
              disabled={saving}
              aria-label="닫기"
            >
              ×
            </button>
            <header className="modal-header">
              <img
                className="mascot mascot-modal"
                src={profileModalMode === 'onboarding' ? mascotWriter : mascotScholar}
                alt=""
                aria-hidden="true"
              />
              <p className="result-eyebrow">PROFILE</p>
              <h2 id="profile-modal-title" className="modal-title">
                {profileModalMode === 'onboarding'
                  ? '사주 정보를 먼저 등록해주세요'
                  : '프로필 수정'}
              </h2>
              <p className="modal-lead">
                {profileModalMode === 'onboarding'
                  ? '처음 로그인한 계정입니다. 필수 정보를 입력하면 다음부터 바로 사주를 볼 수 있어요.'
                  : '이름·생년월일 등 기본 정보를 수정할 수 있습니다.'}
              </p>
            </header>

            <form className="modal-form" onSubmit={handleSaveProfile}>
              <ProfileFields
                form={profileForm}
                onChange={setProfileForm}
                disabled={saving}
                idPrefix="modal"
              />

              {profileError ? <p className="auth-error">{profileError}</p> : null}

              <div className="modal-actions">
                {profileModalMode === 'edit' ? (
                  <button
                    type="button"
                    className="action-btn"
                    onClick={closeProfileModal}
                    disabled={saving}
                  >
                    닫기
                  </button>
                ) : null}
                <button
                  type="submit"
                  className="submit"
                  disabled={!isProfileFormValid(profileForm) || saving}
                >
                  {saving
                    ? '저장 중…'
                    : profileModalMode === 'onboarding'
                      ? '등록하고 시작하기'
                      : '프로필 저장'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {toast ? (
        <div
          key={toast.id}
          className={`toast${toast.leaving ? ' is-leaving' : ''}`}
          role="status"
          aria-live="polite"
        >
          {toast.message}
        </div>
      ) : null}
    </div>
  )
}

export default App
