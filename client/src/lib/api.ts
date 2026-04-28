import axios from 'axios';

// 60 s timeout — accommodates Railway cold-start spin-up time
const api = axios.create({ baseURL: '/api', timeout: 60000 });

api.interceptors.request.use(config => {
  const token = localStorage.getItem('kk_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  res => res,
  err => {
    // 401 → force logout and redirect to login
    if (err.response?.status === 401) {
      localStorage.removeItem('kk_token');
      localStorage.removeItem('kk_user');
      window.location.href = '/login';
      return Promise.reject(err);
    }

    // Network timeout or no response (server unreachable / Railway cold start)
    if (err.code === 'ECONNABORTED' || !err.response) {
      const msg = err.code === 'ECONNABORTED'
        ? 'Request timed out — server may be starting up. Please try again.'
        : 'Network error — check your internet connection and try again.';
      // Use a non-blocking alert so UI is not frozen; can be swapped for a toast lib later
      if (typeof window !== 'undefined') {
        console.warn('[API]', msg, err.message);
        // Only show alert for user-initiated requests (not background polls)
        // Gate on navigator.onLine so we don't double-alert on offline events
        if (!navigator.onLine) {
          // Browser is offline — the 'offline' event will surface this to the user
        } else {
          // Surface to user via a dismissible banner stored in sessionStorage to avoid spam
          const key = `kk_neterr_${err.code ?? 'NET'}`;
          if (!sessionStorage.getItem(key)) {
            sessionStorage.setItem(key, '1');
            setTimeout(() => sessionStorage.removeItem(key), 15000); // allow repeat after 15 s
            window.dispatchEvent(new CustomEvent('kk:network-error', { detail: { message: msg } }));
          }
        }
      }
    }

    return Promise.reject(err);
  }
);

export const authAPI = {
  login: (phone: string, password: string) =>
    api.post('/auth/login', { phone, password }).then(r => r.data),
  me: () => api.get('/auth/me').then(r => r.data),
};

export const staffAPI = {
  list: () => api.get('/staff').then(r => r.data),
  get:  (id: string) => api.get(`/staff/${id}`).then(r => r.data),
  create: (data: Record<string, unknown>) => api.post('/staff', data).then(r => r.data),
  update: (id: string, data: Record<string, unknown>) => api.patch(`/staff/${id}`, data).then(r => r.data),
  delete: (id: string) => api.delete(`/staff/${id}`).then(r => r.data),
  resetPassword: (id: string, newPassword: string) =>
    api.post(`/staff/${id}/reset-password`, { newPassword }).then(r => r.data),
  setAvailability: (id: string, availability: string) =>
    api.patch(`/staff/${id}/availability`, { availability }).then(r => r.data),
  getPerformance: (id: string) => api.get(`/staff/${id}/performance`).then(r => r.data),
  checkin:  () => api.post('/staff/checkin').then(r => r.data),
  checkout: () => api.post('/staff/checkout').then(r => r.data),
};

export const broadcastAPI = {
  send: (message: string) => api.post('/broadcast', { message }).then(r => r.data),
  list: () => api.get('/broadcast').then(r => r.data),
};

export const customersAPI = {
  list: () => api.get('/customers').then(r => r.data),
  get:  (id: string) => api.get(`/customers/${id}`).then(r => r.data),
  create: (data: Record<string, unknown>) => api.post('/customers', data).then(r => r.data),
  bulkImport: (customers: Record<string, unknown>[]) =>
    api.post('/customers/bulk-import', { customers }).then(r => r.data),
  bulkActions: (ids: string[], action: string, value?: string) =>
    api.post('/customers/bulk-actions', { ids, action, value }).then(r => r.data),
  update: (id: string, data: Record<string, unknown>) => api.patch(`/customers/${id}`, data).then(r => r.data),
  delete: (id: string) => api.delete(`/customers/${id}`).then(r => r.data),
  addNote: (id: string, text: string) => api.post(`/customers/${id}/notes`, { text }).then(r => r.data),
  deleteNote: (id: string, noteId: string) => api.delete(`/customers/${id}/notes/${noteId}`).then(r => r.data),
};

export const vendorsAPI = {
  list: () => api.get('/vendors').then(r => r.data),
  get:  (id: string) => api.get(`/vendors/${id}`).then(r => r.data),
  create: (data: Record<string, unknown>) => api.post('/vendors', data).then(r => r.data),
  update: (id: string, data: Record<string, unknown>) => api.patch(`/vendors/${id}`, data).then(r => r.data),
  delete: (id: string) => api.delete(`/vendors/${id}`).then(r => r.data),
  interactions: (id: string) => api.get(`/vendors/${id}/interactions`).then(r => r.data),
};

export const interactionsAPI = {
  list: (params?: { customerId?: string; staffId?: string }) =>
    api.get('/interactions', { params }).then(r => r.data),
  create: (data: Record<string, unknown>) => api.post('/interactions', data).then(r => r.data),
  delete: (id: string) => api.delete(`/interactions/${id}`).then(r => r.data),
};

export const tasksAPI = {
  list: (params?: { completed?: boolean; staffId?: string }) =>
    api.get('/tasks', { params }).then(r => r.data),
  create: (data: Record<string, unknown>) => api.post('/tasks', data).then(r => r.data),
  complete: (id: string) => api.patch(`/tasks/${id}/complete`).then(r => r.data),
  update: (id: string, data: Record<string, unknown>) => api.patch(`/tasks/${id}`, data).then(r => r.data),
  delete: (id: string) => api.delete(`/tasks/${id}`).then(r => r.data),
  transferRequest: (taskId: string, toStaffId: string, conversationId: string) =>
    api.post('/tasks/transfer-request', { taskId, toStaffId, conversationId }).then(r => r.data),
  transferAccept: (taskId: string, messageId: string) =>
    api.post(`/tasks/${taskId}/transfer-accept`, { messageId }).then(r => r.data),
  transferDecline: (taskId: string, messageId: string) =>
    api.post(`/tasks/${taskId}/transfer-decline`, { messageId }).then(r => r.data),
};

export const diaryAPI = {
  list: () => api.get('/diary').then(r => r.data),
  get:  (id: string) => api.get(`/diary/${id}`).then(r => r.data),
  create: (content: string, date?: string) =>
    api.post('/diary', { content, date }).then(r => r.data),
  edit: (id: string, data: { content?: string; aiEntries?: unknown[]; reanalyze?: boolean }) =>
    api.patch(`/diary/${id}`, data).then(r => r.data),
  delete: (id: string) => api.delete(`/diary/${id}`).then(r => r.data),
  reanalyze: (id: string) => api.post(`/diary/${id}/reanalyze`).then(r => r.data),
};

export const exportAPI = {
  download: () => api.get('/export', { responseType: 'blob' }).then(r => r.data),
};

export const auditAPI = {
  list: (params?: { resource?: string; userId?: string; limit?: number }) =>
    api.get('/audit', { params }).then(r => r.data),
};

export const goalsAPI = {
  list: () => api.get('/goals').then(r => r.data),
  create: (data: Record<string, unknown>) => api.post('/goals', data).then(r => r.data),
  update: (id: string, data: Record<string, unknown>) => api.patch(`/goals/${id}`, data).then(r => r.data),
  delete: (id: string) => api.delete(`/goals/${id}`).then(r => r.data),
};

export const templatesAPI = {
  list: () => api.get('/templates').then(r => r.data),
  create: (data: Record<string, unknown>) => api.post('/templates', data).then(r => r.data),
  update: (id: string, data: Record<string, unknown>) => api.patch(`/templates/${id}`, data).then(r => r.data),
  use: (id: string) => api.post(`/templates/${id}/use`).then(r => r.data),
  delete: (id: string) => api.delete(`/templates/${id}`).then(r => r.data),
};

export const aiAPI = {
  chat: (message: string, history: { role: string; content: string }[]) =>
    api.post('/ai/kamal', { message, history }).then(r => r.data),
  recommendations: () => api.get('/ai/recommendations').then(r => r.data),
  dashboardSummary: () => api.get('/ai/dashboard-summary').then(r => r.data),
  weeklyReport: () => api.get('/ai/weekly-report').then(r => r.data),
  sentimentTrend: (customerId: string) => api.get(`/ai/sentiment-trend/${customerId}`).then(r => r.data),
  leaderboard: (teamId?: string, scope?: 'all') =>
    api.get('/ai/leaderboard', { params: { ...(teamId ? { teamId } : {}), ...(scope ? { scope } : {}) } }).then(r => r.data),
  resetLeaderboard: () => api.post('/ai/leaderboard/reset').then(r => r.data),
};

export const insightsAPI = {
  queue:         () => api.get('/insights/queue').then(r => r.data),
  staffBehavior: () => api.get('/insights/staff-behavior').then(r => r.data),
  trends:        () => api.get('/insights/trends').then(r => r.data),
};

export const meritsAPI = {
  list: (params?: { staffId?: string; limit?: number }) =>
    api.get('/merits', { params }).then(r => r.data),
  summary: () => api.get('/merits/summary').then(r => r.data),
  award: (data: { staffId: string; points: number; reason: string }) =>
    api.post('/merits/award', data).then(r => r.data),
  goals: () => api.get('/merits/goals').then(r => r.data),
  createGoal: (data: { staffId: string; targetPoints: number; period: string; reward?: string }) =>
    api.post('/merits/goals', data).then(r => r.data),
  deleteGoal: (id: string) => api.delete(`/merits/goals/${id}`).then(r => r.data),
};

export const teamsAPI = {
  list: () => api.get('/teams').then(r => r.data),
  create: (data: { name: string; members?: string[] }) =>
    api.post('/teams', data).then(r => r.data),
  update: (id: string, data: { name?: string; members?: string[]; pooledTasks?: boolean }) =>
    api.patch(`/teams/${id}`, data).then(r => r.data),
  delete: (id: string) => api.delete(`/teams/${id}`).then(r => r.data),
};

export const attendanceAPI = {
  login:  () => api.post('/attendance/login').then(r => r.data),
  logout: () => api.post('/attendance/logout').then(r => r.data),
  list: (params?: { staffId?: string; from?: string; to?: string }) =>
    api.get('/attendance', { params }).then(r => r.data),
};

export const chatAPI = {
  conversations: () => api.get('/chat/conversations').then(r => r.data),
  createConversation: (data: { type: 'direct' | 'group'; name?: string; members: string[] }) =>
    api.post('/chat/conversations', data).then(r => r.data),
  updateConversation: (id: string, data: Record<string, unknown>) =>
    api.patch(`/chat/conversations/${id}`, data).then(r => r.data),
  deleteConversation: (id: string) =>
    api.delete(`/chat/conversations/${id}`).then(r => r.data),
  messages: (conversationId: string) =>
    api.get(`/chat/conversations/${conversationId}/messages`).then(r => r.data),
  sendMessage: (conversationId: string, text: string) =>
    api.post(`/chat/conversations/${conversationId}/messages`, { text }).then(r => r.data),
};

export const leadsAPI = {
  list: (params?: Record<string, string>) => api.get('/leads', { params }).then(r => r.data),
  get:  (id: string) => api.get(`/leads/${id}`).then(r => r.data),
  create: (data: Record<string, unknown>) => api.post('/leads', data).then(r => r.data),
  update: (id: string, data: Record<string, unknown>) => api.put(`/leads/${id}`, data).then(r => r.data),
  delete: (id: string) => api.delete(`/leads/${id}`).then(r => r.data),
};

export const pdfAPI = {
  list: () => api.get('/pdf').then(r => r.data),
  upload: (file: File) => {
    const form = new FormData();
    form.append('pdf', file);
    return api.post('/pdf/upload', form, { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data);
  },
};

export default api;
