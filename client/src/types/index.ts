export interface User {
  id: string;
  name: string;
  phone: string;
  role: 'admin' | 'staff';
  email?: string;
  avatar: string;
  joinDate: string;
  active?: boolean;
  customers?: string[];
  createdAt?: string;
  streakData?: StreakData;
  availability?: 'available' | 'on_call' | 'out_of_office';
}

export interface StreakData {
  currentStreak: number;
  lastActivityDate: string | null;
  longestStreak: number;
}

export interface Staff extends User {
  role: 'staff';
  customers: string[];
  active: boolean;
  streakData: StreakData;
  availability: 'available' | 'on_call' | 'out_of_office';
}

export type PipelineStatus = 'lead' | 'contacted' | 'interested' | 'negotiating' | 'closed' | 'churned';

export interface CustomerNote {
  id: string;
  text: string;
  createdBy: string;
  createdAt: string;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  email: string;
  assignedTo: string | null;
  status: PipelineStatus;
  lastContact: string | null;
  notes: string;
  notesList?: CustomerNote[];
  tags: string[];
  dealValue: number | null;
  createdAt: string;
  // computed by server
  healthScore?: number;
  healthLabel?: string;
  healthColor?: string;
}

export interface Vendor {
  id: string;
  name: string;
  company: string;
  phone: string;
  email: string;
  category: string;
  status: 'active' | 'inactive';
  notes: string;
  createdAt: string;
}

export interface Performance {
  id: string;
  staffId: string;
  week: string;
  customersContacted: number;
  responseRate: number;
  streak: number;
  entriesLogged: number;
  targets: number;
  achieved: number;
  createdAt: string;
}

export interface Interaction {
  id: string;
  customerId: string;
  staffId: string;
  staffName: string;
  type: 'call' | 'message' | 'meeting' | 'email';
  responded: boolean;
  notes: string;
  followUpDate: string | null;
  createdAt: string;
  source?: string;
}

export interface Task {
  id: string;
  staffId: string;
  customerId: string | null;
  customerName: string | null;
  title: string;
  notes: string;
  dueDate: string;
  completed: boolean;
  completedAt: string | null;
  createdAt: string;
  source?: string;
}

export interface DiaryEntry {
  id: string;
  staffId: string;
  staffName: string;
  content: string;
  date: string;
  status: 'processing' | 'done' | 'error';
  aiEntries: AIExtractedEntry[];
  createdAt: string;
  processedAt?: string;
  error?: string;
  // Hinglish translation
  translatedContent?: string | null;
  detectedLanguage?: 'hindi' | 'english' | 'hinglish';
}

export interface AIExtractedEntry {
  spokenName: string;           // name exactly as spoken/written in entry
  customerName: string;         // resolved display name
  customerId?: string | null;
  matchedCustomerName?: string | null;
  isNewCustomer?: boolean;      // true = auto-created from this entry
  autoCreatedId?: string | null;// id of freshly created customer
  date?: string | null;
  notes: string;                // English summary
  originalNotes?: string;       // original Hinglish/Hindi text
  actionItems?: string[];
  sentiment?: 'positive' | 'neutral' | 'negative';
  confidence: number;
}

export interface AuditLog {
  id: string;
  userId: string;
  userName: string;
  action: string;
  resource: string;
  resourceId: string | null;
  details: string;
  timestamp: string;
}

export interface Recommendation {
  staffId: string;
  staffName: string;
  performanceScore: number;
  summary?: string;
  strengths: string[];
  issues: string[];
  actions: string[];
  priority: 'high' | 'medium' | 'low';
}

export interface DashboardSummary {
  totalStaff: number;
  activeStaff: number;
  totalCustomers: number;
  activeCustomers: number;
  weeklyContacts: number;
  avgResponseRate: number;
  topStreaker: { name: string; streak: number } | null;
  overdueCount: number;
  dueTasksCount: number;
  pipelineValue: number;
}

export interface KamalMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  actionResult?: { type: string; customer?: string; title?: string; stage?: string } | null;
}

// ── New feature types ──────────────────────────────────────────────────────────

export type GoalMetric = 'calls' | 'interactions' | 'tasks_completed' | 'response_rate';

export interface Goal {
  id: string;
  staffId: string;
  metric: GoalMetric;
  target: number;
  current: number;
  progress: number; // 0–100 %
  label: string;
  month: string; // YYYY-MM
  createdAt: string;
}

export interface Template {
  id: string;
  title: string;
  content: string;
  stage: PipelineStatus | null;
  type: 'general' | 'call' | 'message' | 'email' | 'meeting';
  createdByName: string;
  usageCount: number;
  createdAt: string;
}

export interface LeaderboardRow {
  id: string;
  name: string;
  avatar: string;
  availability: 'available' | 'on_call' | 'out_of_office';
  rank: number;
  score: number;
  weekInteractions: number;
  monthInteractions: number;
  responseRate: number;
  streak: number;
  longestStreak: number;
  closedCount: number;
  completedTasks: number;
}

export interface SentimentPoint {
  date: string;
  sentiment: 'positive' | 'neutral' | 'negative';
  score: number;
  notes?: string;
  confidence: number;
}
