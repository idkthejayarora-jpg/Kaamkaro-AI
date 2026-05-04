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
  // Tasks
  pehla_qadam:        { label: 'Pehla Kadam',        icon: '👣', tier: 'bronze', description: 'Pehla task complete kiya' },
  parishramik:        { label: 'Kaam ka Baadshah',   icon: '⚔️',  tier: 'silver', description: '50 tasks complete kiye' },
  karya_ratna:        { label: 'Kaam ka Legend',     icon: '🏅', tier: 'gold',   description: '100 tasks complete kiye' },
  // Streak
  niyamit_karyakarta: { label: 'Chal Pada',          icon: '🔥', tier: 'bronze', description: '7 din ki diary streak' },
  satat_sevak:        { label: 'Roz Ka Yodha',       icon: '⚡', tier: 'silver', description: '30 din ki diary streak' },
  atulit_parishram:   { label: 'Rokna Mushkil Hai',  icon: '💫', tier: 'gold',   description: '100 din ki diary streak' },
  // Deals
  pehli_safalta:      { label: 'Pehli Dikki',        icon: '🤝', tier: 'bronze', description: 'Pehla lead close kiya' },
  vyapar_nipun:       { label: 'Deal Baaz',          icon: '💼', tier: 'silver', description: '5 leads close kiye' },
  shresth_vikreta:    { label: 'Badi Dikki',         icon: '🏆', tier: 'gold',   description: '20 leads close kiye' },
  // Merits
  pratham_samman:     { label: 'Points Starter',     icon: '🌟', tier: 'bronze', description: '50 merit points kamaye' },
  vishisht_samman:    { label: 'Points Khiladi',     icon: '💎', tier: 'silver', description: '200 merit points kamaye' },
  param_samman:       { label: 'Points ka Raja',     icon: '👑', tier: 'gold',   description: '500 merit points kamaye' },
  // Tenure
  nav_sadasya:        { label: '1 Mahina Hua',       icon: '🌱', tier: 'bronze', description: '30 din team mein' },
  niyamit_sadasya:    { label: '3 Mahine Hua',       icon: '🎖️',  tier: 'silver', description: '90 din team mein' },
  varishth_sadasya:   { label: 'Tena Pana',          icon: '🏛️',  tier: 'gold',   description: '1 saal team mein' },
  // Response
  uttam_pratikriya:   { label: 'Call pe Ready',      icon: '📞', tier: 'bronze', description: '90%+ response rate (min 20 calls)' },
  sanchar_shresth:    { label: 'Call Ka King',       icon: '🎯', tier: 'gold',   description: '98%+ response rate (min 30 calls)' },
  // Loop tasks
  niyamit_sevak:      { label: 'Baar Baar Karta',    icon: '🔄', tier: 'bronze', description: '5 loop tasks complete' },
  dhara_karyakarta:   { label: 'Loop ka Ustaad',     icon: '♾️',  tier: 'silver', description: '20 loop tasks complete' },
};

// Badge criteria shape — used by the admin criteria editor
export interface BadgeCriteria {
  tasks:     { bronze: number; silver: number; gold: number };
  streak:    { bronze: number; silver: number; gold: number };
  deals:     { bronze: number; silver: number; gold: number };
  merits:    { bronze: number; silver: number; gold: number };
  tenure:    { bronze: number; silver: number; gold: number };
  response:  {
    bronze: { rate: number; minInteractions: number };
    gold:   { rate: number; minInteractions: number };
  };
  loopTasks: { bronze: number; silver: number };
}

// Human-readable labels for the criteria editor rows
export const CRITERIA_META: {
  key: keyof Omit<BadgeCriteria, 'response'>;
  label: string;
  unit: string;
  tiers: { key: string; badge: string }[];
}[] = [
  { key: 'tasks',     label: 'Tasks Completed',      unit: 'tasks', tiers: [{ key: 'bronze', badge: 'Pehla Kadam' }, { key: 'silver', badge: 'Kaam ka Baadshah' }, { key: 'gold', badge: 'Kaam ka Legend' }] },
  { key: 'streak',    label: 'Diary Streak',         unit: 'days',  tiers: [{ key: 'bronze', badge: 'Chal Pada' }, { key: 'silver', badge: 'Roz Ka Yodha' }, { key: 'gold', badge: 'Rokna Mushkil Hai' }] },
  { key: 'deals',     label: 'Leads Closed (Won)',   unit: 'leads', tiers: [{ key: 'bronze', badge: 'Pehli Dikki' }, { key: 'silver', badge: 'Deal Baaz' }, { key: 'gold', badge: 'Badi Dikki' }] },
  { key: 'merits',    label: 'Merit Points Earned',  unit: 'pts',   tiers: [{ key: 'bronze', badge: 'Points Starter' }, { key: 'silver', badge: 'Points Khiladi' }, { key: 'gold', badge: 'Points ka Raja' }] },
  { key: 'tenure',    label: 'Days on the Team',     unit: 'days',  tiers: [{ key: 'bronze', badge: '1 Mahina Hua' }, { key: 'silver', badge: '3 Mahine Hua' }, { key: 'gold', badge: 'Tena Pana' }] },
  { key: 'loopTasks', label: 'Loop Tasks Completed', unit: 'tasks', tiers: [{ key: 'bronze', badge: 'Baar Baar Karta' }, { key: 'silver', badge: 'Loop ka Ustaad' }] },
];
