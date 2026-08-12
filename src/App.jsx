import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { buildSajuPrompt } from './prompt'
import { supabase } from './lib/supabase'
import './App.css'

const READING_FIELDS =
  'id, name, birth_date, birth_time, gender, calendar_type, result, created_at'

function formatBirthMeta(reading) {
  if (!reading?.birth_date) return ''

  const date = reading.birth_date
  const time = reading.birth_time ? String(reading.birth_time).slice(0, 5) : null
  const calendar = reading.calendar_type === 'lunar' ? '음력' : '양력'
  const genderLabel =
    reading.gender === 'female' ? '여성' : reading.gender === 'male' ? '남성' : null

  return [date, time, calendar, genderLabel].filter(Boolean).join(' · ')
}

function formatShortDate(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('ko-KR', {
    month: 'short',
    day: 'numeric',
  }).format(date)
}

async function fetchSajuReading(form) {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY
  if (!apiKey) {
    throw new Error(
      'VITE_GEMINI_API_KEY가 없습니다. saju-me/.env 에 키를 넣고 개발 서버를 다시 시작해 주세요.',
    )
  }

  const prompt = buildSajuPrompt(form)
  // gemini-2.5-flash는 신규 키에서 막혀 있어서 3.6 Flash + Interactions API 사용
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

async function saveSajuReading(form, resultText) {
  const { data, error } = await supabase
    .from('saju_readings')
    .insert({
      name: form.name,
      birth_date: form.birthDate,
      birth_time: form.birthTime || null,
      gender: form.gender,
      calendar_type: form.calendarType,
      result: resultText,
    })
    .select(READING_FIELDS)
    .single()

  if (error) {
    throw new Error(error.message || '사주 결과 저장에 실패했습니다.')
  }

  return data
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

function App() {
  const [name, setName] = useState('')
  const [birthDate, setBirthDate] = useState('')
  const [birthTime, setBirthTime] = useState('')
  const [gender, setGender] = useState('')
  const [calendarType, setCalendarType] = useState('solar')

  const [result, setResult] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [readings, setReadings] = useState([])
  const [selectedReading, setSelectedReading] = useState(null)
  const [listError, setListError] = useState('')
  const [listLoading, setListLoading] = useState(true)

  const resultRef = useRef(null)
  const nameInputRef = useRef(null)
  const formTopRef = useRef(null)

  const canSubmit = Boolean(name.trim() && birthDate && gender && !loading)
  const selectedId = selectedReading?.id ?? null
  const isViewing = Boolean(selectedReading && result && !loading)
  const resultTitle = selectedReading?.name
    ? `${selectedReading.name}님의 사주`
    : '분석 결과'
  const resultMeta = formatBirthMeta(selectedReading)

  useEffect(() => {
    let cancelled = false

    ;(async () => {
      try {
        const rows = await loadSajuReadings()
        if (!cancelled) {
          setReadings(rows)
          setListError('')
        }
      } catch (err) {
        if (!cancelled) {
          setListError(err?.message || '목록을 불러오지 못했습니다.')
        }
      } finally {
        if (!cancelled) setListLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!result || !resultRef.current) return
    resultRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [selectedId, result])

  const handleSelectReading = (reading) => {
    setSelectedReading(reading)
    setResult(reading.result)
    setError('')
    setName(reading.name ?? '')
    setBirthDate(reading.birth_date ?? '')
    setBirthTime(reading.birth_time ? String(reading.birth_time).slice(0, 5) : '')
    setGender(reading.gender ?? '')
    setCalendarType(reading.calendar_type ?? 'solar')
  }

  const handleNewSaju = () => {
    setName('')
    setBirthDate('')
    setBirthTime('')
    setGender('')
    setCalendarType('solar')
    setResult('')
    setSelectedReading(null)
    setError('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
    requestAnimationFrame(() => {
      nameInputRef.current?.focus()
      formTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  const handleAnalyze = async (e) => {
    e.preventDefault()
    if (!canSubmit) return

    setLoading(true)
    setError('')
    setResult('')
    setSelectedReading(null)

    const form = {
      name: name.trim(),
      birthDate,
      birthTime,
      gender,
      calendarType,
    }

    try {
      const text = await fetchSajuReading(form)
      const saved = await saveSajuReading(form, text)
      setResult(text)
      setSelectedReading(saved)
      setReadings((prev) => [saved, ...prev])
    } catch (err) {
      setError(err?.message || '사주 분석 중 오류가 발생했습니다.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="layout">
      <aside className="sidebar" aria-label="저장된 사주 목록">
        <button type="button" className="new-saju" onClick={handleNewSaju}>
          + 새 사주 만들기
        </button>

        <div className="sidebar-archive">
          <div className="sidebar-heading">
            <p className="sidebar-eyebrow">命錄</p>
            <div className="sidebar-heading-row">
              <h2 className="sidebar-title">저장된 사주</h2>
              {!listLoading && !listError ? (
                <span className="sidebar-count">{readings.length}명</span>
              ) : null}
            </div>
            <p className="sidebar-lead">이전에 본 사주를 다시 열어보세요</p>
          </div>

          {listLoading ? <p className="sidebar-empty">목록을 불러오는 중…</p> : null}
          {listError ? <p className="sidebar-error">{listError}</p> : null}
          {!listLoading && !listError && readings.length === 0 ? (
            <p className="sidebar-empty">아직 저장된 사주가 없습니다.</p>
          ) : null}

          <ul className="sidebar-list">
            {readings.map((reading) => {
              const initial = (reading.name || '?').trim().slice(0, 1)
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
                      <span className="sidebar-item-name">{reading.name}</span>
                      <span className="sidebar-item-meta">
                        {reading.birth_date || formatShortDate(reading.created_at)}
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      </aside>

      <main className="page">
        <div className={`panel${isViewing ? ' is-viewing' : ''}`}>
          <header className="brand" ref={formTopRef}>
            <p className="brand-eyebrow">四柱命理</p>
            <h1>사주 미</h1>
            {isViewing ? (
              <>
                <p className="brand-lead">저장된 사주 결과를 보고 있습니다</p>
                <p className="preview">{selectedReading.name}님의 사주</p>
              </>
            ) : (
              <>
                <p className="brand-lead">사주 보기 전, 기본 정보를 입력해주세요</p>
                <p className={`preview${name.trim() ? '' : ' is-empty'}`}>
                  {name.trim() || 'OOO'}님의 사주
                </p>
              </>
            )}
          </header>

          {!isViewing ? (
            <form className="form" onSubmit={handleAnalyze}>
              <label className="field">
                <span className="field-label">이름</span>
                <input
                  ref={nameInputRef}
                  type="text"
                  placeholder="예: 홍길동"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  autoComplete="name"
                  disabled={loading}
                />
              </label>

              <div className="row">
                <label className="field">
                  <span className="field-label">생년월일</span>
                  <input
                    type="date"
                    value={birthDate}
                    onChange={(e) => setBirthDate(e.target.value)}
                    required
                    disabled={loading}
                  />
                </label>

                <label className="field">
                  <span className="field-label">
                    태어난 시간
                    <span className="field-optional">선택</span>
                  </span>
                  <input
                    type="time"
                    value={birthTime}
                    onChange={(e) => setBirthTime(e.target.value)}
                    disabled={loading}
                  />
                  <span className="field-hint">모르면 비워 두셔도 됩니다</span>
                </label>
              </div>

              <div className="row">
                <label className="field">
                  <span className="field-label">성별</span>
                  <select
                    value={gender}
                    onChange={(e) => setGender(e.target.value)}
                    required
                    disabled={loading}
                  >
                    <option value="">선택하세요</option>
                    <option value="male">남성</option>
                    <option value="female">여성</option>
                  </select>
                </label>

                <fieldset className="field calendar" disabled={loading}>
                  <legend className="field-label">양력 / 음력</legend>
                  <div className="segment">
                    <label>
                      <input
                        type="radio"
                        name="calendarType"
                        value="solar"
                        checked={calendarType === 'solar'}
                        onChange={(e) => setCalendarType(e.target.value)}
                      />
                      양력
                    </label>
                    <label>
                      <input
                        type="radio"
                        name="calendarType"
                        value="lunar"
                        checked={calendarType === 'lunar'}
                        onChange={(e) => setCalendarType(e.target.value)}
                      />
                      음력
                    </label>
                  </div>
                </fieldset>
              </div>

              <button type="submit" className="submit" disabled={!canSubmit}>
                {loading ? '사주 풀이 중…' : '내 사주 보기'}
              </button>
            </form>
          ) : null}

          {loading ? (
            <div className="loading-panel" aria-live="polite">
              <div className="loading-spinner" aria-hidden="true" />
              <p className="loading-title">사주 풀이 중</p>
              <p className="loading-desc">
                입력하신 생년월일시를 바탕으로 사주 원국을 구성하고,
                <br />
                성격·기질·재능을 자세히 읽어 가는 중입니다.
              </p>
              <p className="loading-hint">잠시만 기다려 주세요. 보통 몇 초 정도 걸려요.</p>
            </div>
          ) : null}

          {error ? (
            <div className="error" role="alert">
              <p className="error-title">분석을 완료하지 못했습니다</p>
              <p>{error}</p>
              <button type="button" className="error-retry" onClick={handleNewSaju}>
                입력부터 다시하기
              </button>
            </div>
          ) : null}

          {result && !loading ? (
            <section
              key={selectedId || 'latest'}
              ref={resultRef}
              className="result"
              aria-live="polite"
            >
              <header className="result-header">
                <div className="result-header-top">
                  <p className="result-eyebrow">四柱命理 · 분석 결과</p>
                  <button
                    type="button"
                    className="new-saju new-saju-inline"
                    onClick={handleNewSaju}
                  >
                    + 새 사주 만들기
                  </button>
                </div>
                <h2 className="result-heading">{resultTitle}</h2>
                {resultMeta ? <p className="result-meta">{resultMeta}</p> : null}
              </header>
              <div className="result-body markdown">
                <ReactMarkdown>{result}</ReactMarkdown>
              </div>
              <footer className="result-footer">
                <button type="button" className="new-saju" onClick={handleNewSaju}>
                  + 새 사주 만들기
                </button>
              </footer>
            </section>
          ) : null}
        </div>
      </main>
    </div>
  )
}

export default App
