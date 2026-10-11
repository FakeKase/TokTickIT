import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './layout/AppShell'
import { ChangePasswordPage } from './pages/ChangePasswordPage'
import { CreateTicketPage } from './pages/CreateTicketPage'
import { LoginPage } from './pages/LoginPage'
import { MyTicketsPage } from './pages/MyTicketsPage'
import { RequesterDashboardPage } from './pages/RequesterDashboardPage'
import { StaffDashboardPage } from './pages/StaffDashboardPage'
import { StaffTicketDetailPage } from './pages/StaffTicketDetailPage'
import { StaffTicketQueuePage } from './pages/StaffTicketQueuePage'
import { SystemStatusPage } from './pages/SystemStatusPage'
import { TicketDetailPage } from './pages/TicketDetailPage'
import { UserManagementPage } from './pages/UserManagementPage'
import { AuthProvider } from './auth/AuthProvider'
import { RequireAuth } from './auth/RequireAuth'
import { RequireRole } from './auth/RequireRole'
import { landingPathFor } from './auth/landing'
import { useAuth } from './auth/useAuth'
import { ThemeProvider } from './theme/ThemeProvider'

/**
 * `/` and any address that is not a screen. Neither shows anything: both lead
 * to the Dashboard of whoever is signed in (ui-spec.md §1).
 */
function Landing() {
  const { user } = useAuth()
  return <Navigate to={user ? landingPathFor(user.role) : '/login'} replace />
}

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
                <Route index element={<Landing />} />

                <Route element={<RequireRole allow={['REQUESTER']} />}>
                  <Route path="dashboard" element={<RequesterDashboardPage />} />
                  <Route path="tickets" element={<MyTicketsPage />} />
                  <Route path="tickets/new" element={<CreateTicketPage />} />
                  <Route path="tickets/:id" element={<TicketDetailPage />} />
                </Route>

                <Route element={<RequireRole allow={['IT_STAFF', 'ADMINISTRATOR']} />}>
                  <Route path="staff/dashboard" element={<StaffDashboardPage />} />
                  <Route path="staff/tickets" element={<StaffTicketQueuePage />} />
                  <Route path="staff/tickets/:id" element={<StaffTicketDetailPage />} />
                </Route>

                <Route element={<RequireRole allow={['ADMINISTRATOR']} />}>
                  <Route path="admin/users" element={<UserManagementPage />} />
                  <Route path="system-status" element={<SystemStatusPage />} />
                </Route>

                <Route path="*" element={<Landing />} />
              </Route>
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  )
}

export default App
