import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { isSupabaseConfigured, supabase } from './lib/supabase'
import mascotCrystal from './assets/mascot/crystal.png'
import mascotWave from './assets/mascot/wave.png'
import './App.css'

function formatBirthMeta(source) {
  if (!source?.birth_date) return ''

  const time = source.birth_time ? String(source.birth_time).slice(0, 5) : null
  const calendar = source.calendar_type === 'lunar' ? '음력' : '양력'
  const genderLabel =
    source.gender === 'female' ? '여성' : source.gender === 'male' ? '남성' : null

  return [source.birth_date, time, calendar, genderLabel].filter(Boolean).join(' · ')
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

async function loadSharedSaju(token) {
  const { data, error } = await supabase.rpc('get_shared_saju', {
    p_token: token,
  })

  if (error) {
    throw new Error(error.message || '공유 결과를 불러오지 못했습니다.')
  }

  const row = Array.isArray(data) ? data[0] : data
  if (!row) {
    throw new Error('공유 링크가 없거나 비공개로 전환된 결과입니다.')
  }

  return row
}

export default function SharedResultPage({ token }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reading, setReading] = useState(null)
  const [shareBusy, setShareBusy] = useState(false)
  const [toast, setToast] = useState('')

  useEffect(() => {
    let cancelled = false

    ;(async () => {
      if (!isSupabaseConfigured || !supabase) {
        setError('서비스 설정이 없어 공유 결과를 열 수 없습니다.')
        setLoading(false)
        return
      }

      if (!token) {
        setError('잘못된 공유 링크입니다.')
        setLoading(false)
        return
      }

      try {
        const row = await loadSharedSaju(token)
        if (!cancelled) {
          setReading(row)
          setError('')
        }
      } catch (err) {
        if (!cancelled) {
          setError(err?.message || '공유 결과를 불러오지 못했습니다.')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [token])

  const title = reading?.name ? `${reading.name}님의 사주` : '사주 결과'
  const meta = reading ? formatBirthMeta(reading) : ''

  const handleShare = async () => {
    if (shareBusy) return
    setShareBusy(true)
    try {
      const url = window.location.href
      const mode = await shareResultLink(url, title)
      if (mode === 'copied' || mode === 'prompted') {
        setToast('공유 링크를 복사했어요')
      } else if (mode === 'shared') {
        setToast('공유했어요')
      }
    } catch (err) {
      setToast(err?.message || '공유에 실패했습니다.')
    } finally {
      setShareBusy(false)
      window.setTimeout(() => setToast(''), 2200)
    }
  }

  return (
    <div className="app shared-app">
      <main className="panel is-viewing shared-panel">
        <header className="brand">
          <p className="brand-eyebrow">四柱命理</p>
          <h1>사주 미</h1>
          <p className="brand-lead">친구가 공유한 사주 결과입니다</p>
        </header>

        {loading ? (
          <div className="loading-panel" aria-live="polite">
            <img className="mascot mascot-crystal" src={mascotCrystal} alt="" />
            <div className="loading-spinner" aria-hidden="true" />
            <p className="loading-title">결과 불러오는 중</p>
          </div>
        ) : null}

        {error ? (
          <div className="error" role="alert">
            <img
              className="mascot mascot-wave-inline"
              src={mascotWave}
              alt=""
              aria-hidden="true"
            />
            <p className="error-title">결과를 열 수 없습니다</p>
            <p>{error}</p>
            <a className="error-retry" href="/">
              홈으로 가기
            </a>
          </div>
        ) : null}

        {reading && !loading && !error ? (
          <section className="result" aria-live="polite">
            <header className="result-header">
              <img
                className="mascot mascot-crystal-result"
                src={mascotCrystal}
                alt=""
                aria-hidden="true"
              />
              <div className="result-header-top">
                <p className="result-eyebrow">四柱命理 · 공유 결과</p>
                <div className="result-actions">
                  <button
                    type="button"
                    className="action-btn action-btn-share"
                    onClick={handleShare}
                    disabled={shareBusy}
                  >
                    {shareBusy ? '준비 중…' : '공유하기'}
                  </button>
                  <a className="action-btn" href="/">
                    내 사주 보기
                  </a>
                </div>
              </div>
              <h2 className="result-heading">{title}</h2>
              {meta ? <p className="result-meta">{meta}</p> : null}
            </header>
            <div className="result-body markdown">
              <ReactMarkdown>{reading.result}</ReactMarkdown>
            </div>
            <footer className="result-footer">
              <div className="result-footer-actions">
                <button
                  type="button"
                  className="submit"
                  onClick={handleShare}
                  disabled={shareBusy}
                >
                  {shareBusy ? '준비 중…' : '이 결과 공유하기'}
                </button>
              </div>
            </footer>
          </section>
        ) : null}
      </main>

      {toast ? (
        <div className="toast" role="status" aria-live="polite">
          {toast}
        </div>
      ) : null}
    </div>
  )
}
