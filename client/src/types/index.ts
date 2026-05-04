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
  attendanceStatus?: 'active' | 'inactive';
  lastCheckinAt?: string;
  lastCheckoutAt?: string;
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
  assignedTo: string | null;          // primary assignee (backward compat)
  assignedStaff?: string[];           // all staff who handle this customer
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
  type: 'call' | 'message' | 'meeting' | 'email' | 'diary';
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
  diaryEntryId?: string | null;
  rescheduledCount?: number;
  lastRescheduledAt?: string | null;
  transferredFrom?: string | null;
  transferredAt?: string | null;
  teamId?: string | null;
  completedBy?: string | null;
  isLoop?: boolean;
  loopInterval?: 'daily' | 'every2days' | 'weekly';
  loopMerit?: number;
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
  customerName: string;         // resolved display name (or vendor name if isVendor)
  customerId?: string | null;
  matchedCustomerName?: string | null;
  isNewCustomer?: boolean;      // true = auto-created from this entry
  autoCreatedId?: string | null;// id of freshly created customer
  // Vendor matching
  isVendor?: boolean;           // true = matched a vendor, not a customer
  vendorId?: string | null;
  vendorName?: string | null;
  date?: string | null;
  notes: string;                // English summary
  originalNotes?: string;       // original Hinglish/Hindi text
  actionItems?: string[];
  sentiment?: 'positive' | 'neutral' | 'negative';
  confidence: number;
}

export interface VendorInteraction {
  id: string;
  vendorId: string;
  vendorName: string;
  staffId: string;
  staffName: string;
  notes: string;
  diaryEntryId: string;
  sentiment: 'positive' | 'neutral' | 'negative';
  createdAt: string;
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

export interface TemplateAttachment {
  name: string;
  originalName: string;
  url: string;
  mimetype: string;
}

export interface Template {
  id: string;
  title: string;
  content: string;
  stage: PipelineStatus | null;
  type: 'general' | 'call' | 'message' | 'email' | 'meeting';
  createdByName: string;
  usageCount: number;
  attachments?: TemplateAttachment[];
  createdAt: string;
}

export interface LeaderboardRow {
  id: string;
  name: string;
  avatar: string;
  availability: 'available' | 'on_call' | 'out_of_office';
  teamId: string | null;
  teamName: string | null;
  rank: number;
  score: number;
  weekInteractions: number;
  monthInteractions: number;
  responseRate: number;
  streak: number;
  longestStreak: number;
  closedCount: number;
  closedThisWeek: number;
  completedTasks: number;
  totalTasks: number;
  taskCompletionRate: number;
  weekPts: number;
  meritTotal: number;
  weekDelta: number;
  customerCount: number;
}

export interface Team {
  id: string;
  name: string;
  members: string[];   // staff IDs
  pooledTasks: boolean;
  createdAt: string;
  updatedAt?: string;
}

export interface SentimentPoint {
  date: string;
  sentiment: 'positive' | 'neutral' | 'negative';
  score: number;
  notes?: string;
  confidence: number;
}

// ── Attendance ────────────────────────────────────────────────────────────────
export interface AttendanceSession {
  loginAt: string;
  logoutAt: string | null;
  hours?: number;
}

export interface AttendanceRecord {
  id: string;
  staffId: string;
  staffName: string;
  date: string;           // YYYY-MM-DD
  loginAt: string;        // first login of the day
  logoutAt: string | null;
  hoursWorked: number;
  sessions: AttendanceSession[];
}

// ── Follow-up Queue & Insights ────────────────────────────────────────────────

export interface CustomerInsight {
  customerId: string;
  customerName: string;
  phone: string;
  status: PipelineStatus;
  assignedTo: string | null;
  assignedStaffName: string;
  assignedStaffAvatar: string;
  dealValue: number | null;
  lastContactDays: number | null;
  priorityScore: number;
  priority: 'urgent' | 'high' | 'medium' | 'low';
  patterns: {
    responsiveness: 'responsive' | 'slow' | 'ignoring' | 'ghosting';
    orderFrequency: 'frequent' | 'occasional' | 'rare';
    sentimentTrend: 'improving' | 'stable' | 'declining' | 'unknown';
    hasPaymentDelay: boolean;
    avgOrderCycleDays: number | null;
    staffConcern: boolean;
  };
  metrics: {
    totalInteractions: number;
    positiveRatio: number;
    negativeRatio: number;
    responseRate: number;
    orderMentions: number;
    totalDiaryMentions: number;
  };
  insight: string | null;
  nextAction: string | null;
}

export interface StaffBehavior {
  staffId: string;
  staffName: string;
  avatar: string;
  customersAssigned: number;
  totalInteractions: number;
  recentInteractions: number;
  coverage: number;
  sentimentScore: number;
  responseRate: number;
  qualityScore: number;
  qualityLabel: 'excellent' | 'good' | 'needs_attention';
  concernedCustomers: { id: string; name: string }[];
  overdueCount: number;
  streak: number;
}

export interface InsightsTrends {
  pipelineBreakdown: Record<string, number>;
  pipelineValue: number;
  closedValue: number;
  sentimentByWeek: { week: string; responseRate: number; positiveRate: number; total: number }[];
  topCustomers: { id: string; name: string; interactions: number; status: string; dealValue: number | null }[];
  ghostCustomers: { id: string; name: string; daysSince: number | null }[];
  topTags: { tag: string; count: number }[];
  totalCustomers: number;
  totalInteractions: number;
}

// ── Merit System ──────────────────────────────────────────────────────────────

export interface Merit {
  id: string;
  staffId: string;
  staffName: string;
  points: number;
  reason: string;
  category: 'task' | 'streak' | 'conversion' | 'overdue' | 'manual';
  relatedId: string | null;
  createdAt: string;
}

export interface MeritBreakdown {
  task: number;
  streak: number;
  conversion: number;
  penalties: number;
}

export interface MeritSummary {
  staffId: string;
  name: string;
  avatar: string;
  total: number;
  weekPts: number;
  monthPts: number;
  breakdown: MeritBreakdown;
  weekBreak: MeritBreakdown;
  recentEvents: Merit[];
}

export interface MeritGoal {
  id: string;
  staffId: string;
  staffName: string;
  targetPoints: number;
  period: string;
  reward: string;
  createdAt: string;
}

// ── Chat ──────────────────────────────────────────────────────────────────────
export interface ChatConversation {
  id: string;
  type: 'direct' | 'group';
  name: string | null;
  members: string[];
  createdBy: string;
  createdAt: string;
  lastMessageAt: string;
  lastMessageText: string | null;
}

export interface TaskTransferMetadata {
  taskId: string;
  taskTitle: string;
  taskDueDate: string;
  taskCustomerName: string | null;
  taskNotes?: string;
  fromStaffId: string;
  fromStaffName: string;
  toStaffId: string;
  toStaffName: string;
  status: 'pending' | 'accepted' | 'declined';
  resolvedAt?: string;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  senderId: string;
  senderName: string;
  senderAvatar: string;
  text: string;
  sentAt: string;
  messageType?: 'text' | 'task_transfer';
  metadata?: TaskTransferMetadata;
}

// ── CRM Leads ─────────────────────────────────────────────────────────────────

export type LeadStage =
  | 'new' | 'contacted' | 'interested' | 'catalogue_sent'
  | 'follow_up' | 'visit_scheduled' | 'won' | 'lost';

export type LeadSource = 'walk_in' | 'referral' | 'phone' | 'instagram' | 'whatsapp' | 'other';

export interface LeadNote {
  text: string;
  date: string; // ISO string
}

export interface Lead {
  id: string;
  staffId: string;            // owner — set on creation, used for scoping
  linkedCustomerId: string | null; // customer record created at same time
  name: string;
  phone: string;
  place: string;
  source: LeadSource;
  stage: LeadStage;
  notes: LeadNote[];
  nextFollowUp: string | null;  // YYYY-MM-DD
  visitDate: string | null;     // YYYY-MM-DD
  noPickupCount: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  // Admin-only: attached server-side
  staffName?: string;
  teamName?:  string;
}

// ── Stock Tracking ─────────────────────────────────────────────────────────────

export interface StockHistoryEntry {
  id: string;
  date: string;
  qty: number;
  unit: string;
  customerId: string | null;
  customerName: string | null;
  diaryEntryId: string | null;
  note: string | null;
}

export interface StockItem {
  id: string;
  staffId: string;
  staffName: string;
  itemName: string;
  totalSold: number;
  unit: string;
  history: StockHistoryEntry[];
  createdAt: string;
  updatedAt: string;
}

// ── PDF Upload ─────────────────────────────────────────────────────────────────

export interface PDFExtractedEntry {
  customerName: string;
  matchedCustomerName: string | null;
  matchedCustomerId: string | null;
  isNewCustomer: boolean;
  date: string | null;
  notes: string;
  actionItems: string[];
  sentiment: 'positive' | 'neutral' | 'negative';
  confidence: number;
}

export interface PDFEntry {
  id: string;
  fileName: string;
  status: 'processing' | 'done' | 'error';
  entries: PDFExtractedEntry[];
  error?: string;
  uploadedAt: string;
  processedAt?: string;
}

// ── Badges ────────────────────────────────────────────────────────────────────

export interface Badge {
  id: string;
  staffId: string;
  staffName: string;
  badgeKey: string;
  label: string;
  icon: string;
  tier: 'bronze' | 'silver' | 'gold';
  earnedAt: string;
}

export interface BadgeMeta {
  label: string;
  icon: string;
  tier: 'bronze' | 'silver' | 'gold';
  description: string;
}

// Full catalogue — mirrors server/utils/badgeEarner.js BADGES object
export const BADGE_META: Record<string, BadgeMeta> = {
  first_steps:     { label: 'Pehla Kadam',       icon: '👣', tier: 'bronze', description: 'Pehla task complete kiya' },
  task_warrior:    { label: 'Kaam ka Baadshah',  icon: '⚔️',  tier: 'silver', description: '50 tasks complete' },
  task_legend:     { label: 'Kaam ka Legend',    icon: '🏅', tier: 'gold',   description: '100 tasks complete' },
  on_a_roll:       { label: 'Chal Pada',         icon: '🔥', tier: 'bronze', description: '7 din ki diary streak' },
  streak_master:   { label: 'Roz Ka Yodha',      icon: '⚡', tier: 'silver', description: '30 din ki diary streak' },
  unstoppable:     { label: 'Rokna Mushkil Hai', icon: '💫', tier: 'gold',   description: '100 din ki diary streak' },
  first_deal:      { label: 'Pehli Dikki',       icon: '🤝', tier: 'bronze', description: 'Pehla lead close kiya' },
  deal_maker:      { label: 'Deal Baaz',         icon: '💼', tier: 'silver', description: '5 leads close kiye' },
  closer:          { label: 'Badi Dikki',        icon: '🏆', tier: 'gold',   description: '20 leads close kiye' },
  merit_rookie:    { label: 'Points Starter',    icon: '🌟', tier: 'bronze', description: '50 merit points kamaye' },
  merit_pro:       { label: 'Points Khiladi',    icon: '💎', tier: 'silver', description: '200 merit points kamaye' },
  merit_elite:     { label: 'Points ka Raja',    icon: '👑', tier: 'gold',   description: '500 merit points kamaye' },
  old_timer:       { label: '1 Mahina Hua',      icon: '📅', tier: 'bronze', description: '30 din team mein' },
  veteran:         { label: '3 Mahine Hua',      icon: '🎖️',  tier: 'silver', description: '90 din team mein' },
  pillar:          { label: 'Tena Pana',         icon: '🏛️',  tier: 'gold',   description: '1 saal team mein' },
  sharp_responder: { label: 'Call pe Ready',     icon: '📞', tier: 'bronze', description: '90%+ response rate (min 20 calls)' },
  call_champion:   { label: 'Call Ka King',      icon: '🎯', tier: 'gold',   description: '98%+ response rate (min 30 calls)' },
  loop_closer:     { label: 'Baar Baar Karta',   icon: '🔄', tier: 'bronze', description: '5 loop tasks complete' },
  loop_master:     { label: 'Loop ka Ustaad',    icon: '♾️',  tier: 'silver', description: '20 loop tasks complete' },
};
