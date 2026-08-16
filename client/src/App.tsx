import { useState } from 'react'
import type { Category } from './api'
import { fetchHealth, fetchCategories } from './api'
import sunIcon from './assets/sun.png'
import moonIcon from './assets/moon.png'

type CheckState =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'online'; service: string; categories: Category[] }
  | { phase: 'offline'; message: string }

type Theme = 'light' | 'dark'

function App() {
  const [check, setCheck] = useState<CheckState>({ phase: 'idle' })
  const [theme, setTheme] = useState<Theme>('light')

  async function handleCheckSystem() {
    setCheck({ phase: 'loading' })

    try {
      await fetchHealth()
      const categories = await fetchCategories()
      setCheck({ phase: 'online', service: 'TokTickIT API', categories })
    } catch {
      setCheck({
        phase: 'offline',
        message: 'Unable to connect to TokTickIT API',
      })
    }
  }

  const isDark = theme === 'dark'
  const bgColor = isDark ? '#1a1a1a' : '#f8f9fa'
  const textColor = isDark ? '#ffffff' : '#000000'
  const cardBg = isDark ? '#2d2d2d' : '#ffffff'
  const headerBg = isDark ? '#0d0d0d' : '#ffffff'
  const secondaryText = isDark ? '#b0b0b0' : '#666666'
  const borderColor = isDark ? '#404040' : '#e9ecef'

  return (
    <div
      style={{
        height: '100vh',
        width: '100vw',
        backgroundColor: bgColor,
        color: textColor,
        transition: 'all 0.3s ease',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        margin: 0,
        padding: 0,
      }}
    >
      {/* Header */}
      <header
        style={{
          backgroundColor: headerBg,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '2rem 3rem',
          flexShrink: 0,
          width: '100%',
          boxSizing: 'border-box',
        }}
      >
        <div>
          <h1 style={{ fontSize: '2.5rem', fontWeight: '700', margin: '0', color: textColor }}>
            TokTickIT
          </h1>
        </div>

        <button
          onClick={() => setTheme(isDark ? 'light' : 'dark')}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '0.5rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '50px',
            height: '50px',
            borderRadius: '8px',
            backgroundColor: isDark ? '#333' : '#f0f0f0',
            transition: 'all 0.3s ease',
            flexShrink: 0,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = isDark ? '#404040' : '#e0e0e0'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = isDark ? '#333' : '#f0f0f0'
          }}
          title={isDark ? 'Light Mode' : 'Dark Mode'}
        >
          <img
            src={isDark ? sunIcon : moonIcon}
            alt={isDark ? 'Light Mode' : 'Dark Mode'}
            style={{
              width: '24px',
              height: '24px',
              filter: isDark ? 'invert(1) brightness(0.9)' : 'none',
            }}
          />
        </button>
      </header>

      {/* Main Content */}
      <main
        style={{
          flex: 1,
          width: '100%',
          padding: '3rem 3rem',
          boxSizing: 'border-box',
          overflowY: 'auto',
          overflowX: 'hidden',
        }}
      >
        {/* Control Section */}
        <div style={{ marginBottom: '3rem' }}>
          <h2
            style={{
              fontSize: '2rem',
              fontWeight: '700',
              marginBottom: '0.5rem',
              color: textColor,
            }}
          >
            What can we help you with?
          </h2>
          <p style={{ fontSize: '1.1rem', color: secondaryText, marginBottom: '2rem' }}>
            Select a category below to submit your request
          </p>

          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <button
              type="button"
              onClick={handleCheckSystem}
              disabled={check.phase === 'loading'}
              style={{
                padding: '0.75rem 1.5rem',
                fontSize: '1rem',
                fontWeight: '600',
                border: 'none',
                borderRadius: '8px',
                backgroundColor: '#198754',
                color: 'white',
                cursor: check.phase === 'loading' ? 'not-allowed' : 'pointer',
                opacity: check.phase === 'loading' ? 0.7 : 1,
              }}
            >
              {check.phase === 'loading' ? 'Checking…' : 'Check System'}
            </button>

            {check.phase === 'online' && (
              <span
                style={{
                  padding: '0.5rem 1rem',
                  fontSize: '0.9rem',
                  fontWeight: '600',
                  backgroundColor: '#d1e7dd',
                  color: '#0f5132',
                  borderRadius: '20px',
                }}
              >
                Online
              </span>
            )}
            {check.phase === 'offline' && (
              <span
                style={{
                  padding: '0.5rem 1rem',
                  fontSize: '0.9rem',
                  fontWeight: '600',
                  backgroundColor: '#f8d7da',
                  color: '#842029',
                  borderRadius: '20px',
                }}
              >
                Offline
              </span>
            )}
          </div>
        </div>

        {/* Error State */}
        {check.phase === 'offline' && (
          <div
            role="alert"
            style={{
              padding: '1.5rem',
              backgroundColor: isDark ? '#3d2e2e' : '#f8d7da',
              border: `1px solid ${isDark ? '#5a4242' : '#f5c2c7'}`,
              borderRadius: '12px',
              color: isDark ? '#f5a5a5' : '#842029',
              fontSize: '1rem',
              marginBottom: '2rem',
            }}
          >
            <strong>Connection Error</strong>
            <p style={{ margin: '0.5rem 0 0 0' }}>{check.message}</p>
          </div>
        )}

        {/* Categories Grid */}
        {check.phase === 'online' && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              gap: '2rem',
            }}
          >
            {check.categories.map((category) => (
              <div
                key={category.id}
                style={{
                  backgroundColor: cardBg,
                  borderRadius: '12px',
                  padding: '2rem',
                  border: `1px solid ${borderColor}`,
                  boxShadow: isDark ? '0 2px 8px rgba(0,0,0,0.3)' : '0 2px 8px rgba(0,0,0,0.08)',
                  transition: 'all 0.3s ease',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.boxShadow = isDark ? '0 8px 16px rgba(0,0,0,0.5)' : '0 8px 16px rgba(0,0,0,0.12)'
                  e.currentTarget.style.transform = 'translateY(-4px)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.boxShadow = isDark ? '0 2px 8px rgba(0,0,0,0.3)' : '0 2px 8px rgba(0,0,0,0.08)'
                  e.currentTarget.style.transform = 'translateY(0)'
                }}
              >
                <h3
                  style={{
                    fontSize: '1.5rem',
                    fontWeight: '700',
                    marginBottom: '0.5rem',
                    color: '#198754',
                  }}
                >
                  {category.name}
                </h3>
                <p
                  style={{
                    fontSize: '1rem',
                    color: secondaryText,
                    flex: 1,
                    marginBottom: '1.5rem',
                    lineHeight: '1.5',
                  }}
                >
                  {category.description}
                </p>
                <button
                  style={{
                    padding: '0.75rem 1.5rem',
                    fontSize: '1rem',
                    fontWeight: '600',
                    border: '2px solid #198754',
                    borderRadius: '8px',
                    backgroundColor: 'white',
                    color: '#198754',
                    cursor: 'pointer',
                    transition: 'all 0.3s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = '#198754'
                    e.currentTarget.style.color = 'white'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'white'
                    e.currentTarget.style.color = '#198754'
                  }}
                >
                  Submit Request →
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Loading State */}
        {check.phase === 'loading' && (
          <div style={{ textAlign: 'center', paddingTop: '3rem' }}>
            <div
              style={{
                display: 'inline-block',
                width: '40px',
                height: '40px',
                border: `4px solid ${isDark ? '#404040' : '#e9ecef'}`,
                borderTop: '4px solid #198754',
                borderRadius: '50%',
                animation: 'spin 1s linear infinite',
                marginBottom: '1rem',
              }}
            />
            <p style={{ fontSize: '1.1rem', color: secondaryText }}>Loading categories…</p>
          </div>
        )}
      </main>

      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}

export default App
