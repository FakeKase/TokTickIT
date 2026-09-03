import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './layout/AppShell'
import { CheckSystemPage } from './pages/CheckSystemPage'
import { CreateTicketPage } from './pages/CreateTicketPage'
import { MyTicketsPage } from './pages/MyTicketsPage'
import { RequesterSelectionPage } from './pages/RequesterSelectionPage'
import { TicketDetailPage } from './pages/TicketDetailPage'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<CheckSystemPage />} />
          <Route path="select-requester" element={<RequesterSelectionPage />} />
          <Route path="tickets" element={<MyTicketsPage />} />
          <Route path="tickets/new" element={<CreateTicketPage />} />
          <Route path="tickets/:id" element={<TicketDetailPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default App
