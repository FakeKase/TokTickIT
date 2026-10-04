import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './layout/AppShell'
import { CheckSystemPage } from './pages/CheckSystemPage'
import { ChangePasswordPage } from './pages/ChangePasswordPage'
import { ComingSoonPage } from './pages/ComingSoonPage'
import { CreateTicketPage } from './pages/CreateTicketPage'
import { LoginPage } from './pages/LoginPage'
import { MyTicketsPage } from './pages/MyTicketsPage'
import { StaffTicketDetailPage } from './pages/StaffTicketDetailPage'
import { StaffTicketQueuePage } from './pages/StaffTicketQueuePage'
import { TicketDetailPage } from './pages/TicketDetailPage'
import { AuthProvider } from './auth/AuthProvider'
import { RequireAuth } from './auth/RequireAuth'
import { RequireRole } from './auth/RequireRole'
import { ThemeProvider } from './theme/ThemeProvider'

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            {/* Outside the shell: neither screen has anywhere to navigate to
                (ui-spec.md §1). */}
            <Route path="/login" element={<LoginPage />} />
            <Route path="/change-password" element={<ChangePasswordPage />} />

            {/* Everything else requires a session and a settled password. */}
            <Route element={<RequireAuth />}>
              <Route element={<AppShell />}>
                <Route index element={<CheckSystemPage />} />

                <Route element={<RequireRole allow={['REQUESTER']} />}>
                  <Route path="tickets" element={<MyTicketsPage />} />
                  <Route path="tickets/new" element={<CreateTicketPage />} />
                  <Route path="tickets/:id" element={<TicketDetailPage />} />
                </Route>

                <Route element={<RequireRole allow={['IT_STAFF', 'ADMINISTRATOR']} />}>
                  <Route path="staff/tickets" element={<StaffTicketQueuePage />} />
                  <Route path="staff/tickets/:id" element={<StaffTicketDetailPage />} />
                </Route>

                {/* Issue #45 builds this. Mounted now behind its real route
                    and guard so the Administrator's landing page and nav link
                    go somewhere. */}

                <Route element={<RequireRole allow={['ADMINISTRATOR']} />}>
                  <Route
                    path="admin/users"
                    element={<ComingSoonPage title="User Management" issue="Issue #45" />}
                  />
                </Route>

                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  )
}

export default App
