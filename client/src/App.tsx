import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './layout/AppShell'
import { CheckSystemPage } from './pages/CheckSystemPage'
import { CreateTicketPage } from './pages/CreateTicketPage'
import { MyTicketsPage } from './pages/MyTicketsPage'
import { RequesterSelectionPage } from './pages/RequesterSelectionPage'
import { TicketDetailPage } from './pages/TicketDetailPage'
import { RequesterProvider } from './requester/RequesterProvider'
import { RequireRequester } from './requester/RequireRequester'

function App() {
  return (
    <RequesterProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<CheckSystemPage />} />
            <Route path="select-requester" element={<RequesterSelectionPage />} />

            {/* Requester-scoped screens: AC-02 sends the user to the selector
                when no Development Requester has been chosen. */}
            <Route element={<RequireRequester />}>
              <Route path="tickets" element={<MyTicketsPage />} />
              <Route path="tickets/new" element={<CreateTicketPage />} />
              <Route path="tickets/:id" element={<TicketDetailPage />} />
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </RequesterProvider>
  )
}

export default App
