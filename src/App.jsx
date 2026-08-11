import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { buildSajuPrompt } from './prompt'
import './App.css'

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

function App() {
  const [name, setName] = useState('')
  const [birthDate, setBirthDate] = useState('')
  const [birthTime, setBirthTime] = useState('')
  const [gender, setGender] = useState('')
  const [calendarType, setCalendarType] = useState('solar')

  const [result, setResult] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const canSubmit = name.trim() && birthDate && gender && !loading

  const handleAnalyze = async (e) => {
    e.preventDefault()
    if (!canSubmit) return

    setLoading(true)
    setError('')
    setResult('')

    try {
      const text = await fetchSajuReading({
        name: name.trim(),
        birthDate,
        birthTime,
        gender,
        calendarType,
      })
      setResult(text)
    } catch (err) {
      setError(err?.message || '사주 분석 중 오류가 발생했습니다.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="page">
      <div className="panel">
        <header className="brand">
          <p className="brand-eyebrow">四柱命理</p>
          <h1>사주 미</h1>
          <p className="brand-lead">사주 보기 전, 기본 정보를 입력해주세요</p>
          <p className={`preview${name.trim() ? '' : ' is-empty'}`}>
            {name.trim() || 'OOO'}님의 사주
          </p>
        </header>

        <form className="form" onSubmit={handleAnalyze}>
          <label className="field">
            <span className="field-label">이름</span>
            <input
              type="text"
              placeholder="예: 홍길동"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoComplete="name"
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
              />
            </label>

            <label className="field">
              <span className="field-label">태어난 시간</span>
              <input
                type="time"
                value={birthTime}
                onChange={(e) => setBirthTime(e.target.value)}
              />
            </label>
          </div>

          <div className="row">
            <label className="field">
              <span className="field-label">성별</span>
              <select
                value={gender}
                onChange={(e) => setGender(e.target.value)}
                required
              >
                <option value="">선택하세요</option>
                <option value="male">남성</option>
                <option value="female">여성</option>
              </select>
            </label>

            <fieldset className="field calendar">
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
            내 사주 보기
          </button>
        </form>

        {loading ? (
          <div className="loading-panel" aria-live="polite">
            <p className="loading-title">사주 풀이 중</p>
            <p className="loading-desc">
              입력하신 생년월일시를 바탕으로 사주 원국을 구성하고,
              <br />
              성격·기질·재능을 자세히 읽어 가는 중입니다.
            </p>
            <p className="loading-hint">잠시만 기다려 주세요. 보통 몇 초 정도 걸려요.</p>
          </div>
        ) : null}

        {error ? <p className="error">{error}</p> : null}

        {result ? (
          <section className="result" aria-live="polite">
            <h2 className="result-heading">분석 결과</h2>
            <div className="result-body markdown">
              <ReactMarkdown>{result}</ReactMarkdown>
            </div>
          </section>
        ) : null}
      </div>
    </main>
  )
}

export default App
