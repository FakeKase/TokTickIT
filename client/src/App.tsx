function App() {
  return (
    <div className="min-vh-100 bg-body-tertiary">
      <nav className="navbar navbar-dark bg-success">
        <div className="container">
          <span className="navbar-brand mb-0 h1">TokTickIT</span>
        </div>
      </nav>

      <main className="container py-5">
        <h1 className="h3 mb-4">TokTickIT IT Service Desk</h1>

        <div className="card shadow-sm">
          <div className="card-body">
            {/* The [Check System] button and its results arrive in Issues 2 and 4. */}
            <p className="text-body-secondary mb-0">
              Project foundation is in place. System check coming next.
            </p>
          </div>
        </div>
      </main>
    </div>
  )
}

export default App
