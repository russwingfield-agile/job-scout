import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { ToastProvider } from './components/ui/Toast.js';
import { AppRoutes } from './router.js';
import './styles.css';

const queryClient = new QueryClient({
  // A failed call is usually a real error (validation, auth), not a blip: do not hammer the API.
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});
const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
