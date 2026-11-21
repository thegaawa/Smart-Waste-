import type { AssignmentStatus, Priority, ReportStatus } from "./reports.js";
import type { Role, UserStatus } from "./roles.js";

/**
 * Request and response shapes for the Smart-Waste REST API (Table 3.4 plus the
 * extra endpoints needed in practice). Dates are ISO-8601 strings.
 */

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export const ApiErrorCode = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  INVALID_TRANSITION: "INVALID_TRANSITION",
  RATE_LIMITED: "RATE_LIMITED",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export type ApiErrorCode = (typeof ApiErrorCode)[keyof typeof ApiErrorCode];

export interface FieldError {
  /** Dotted path of the offending field, e.g. "password" or "location.latitude". */
  field: string;
  message: string;
}

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    /** Present for VALIDATION_ERROR so clients can highlight the field (T04). */
    details?: FieldError[];
  };
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

export interface HealthResponse {
  status: "ok" | "degraded";
  service: "smart-waste-api";
  version: string;
  time: string;
  database: "up" | "down";
}

// ---------------------------------------------------------------------------
// Auth (FR-01)
// ---------------------------------------------------------------------------

export interface AuthUser {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: Role;
  status: UserStatus;
  createdAt: string;
}

export interface RegisterRequest {
  name: string;
  /** At least one of email or phone is required. */
  email?: string;
  phone?: string;
  password: string;
}

export interface LoginRequest {
  /** Email address or phone number. */
  identifier: string;
  password: string;
}

export interface AuthTokens {
  accessToken: string;
  /** Seconds until the access token expires. */
  accessTokenExpiresIn: number;
  refreshToken: string;
}

export interface AuthResponse extends AuthTokens {
  user: AuthUser;
}

export interface RefreshRequest {
  refreshToken: string;
}

export interface LogoutRequest {
  refreshToken: string;
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export interface CategoryDto {
  id: string;
  name: string;
  description: string | null;
  defaultPriority: Priority;
  active: boolean;
}

export interface UpsertCategoryRequest {
  name: string;
  description?: string;
  defaultPriority?: Priority;
  active?: boolean;
}

// ---------------------------------------------------------------------------
// Reports (FR-02 to FR-06, FR-09, FR-10)
// ---------------------------------------------------------------------------

export interface MediaDto {
  id: string;
  /** Time-limited URL the client can load the photo from. */
  url: string;
  mediaType: "IMAGE";
  uploadedAt: string;
}

export interface StatusHistoryDto {
  id: string;
  oldStatus: ReportStatus | null;
  newStatus: ReportStatus;
  note: string | null;
  changedAt: string;
  changedBy: { id: string; name: string; role: Role } | null;
}

export interface AssignmentDto {
  id: string;
  status: AssignmentStatus;
  assignee: { id: string; name: string };
  assignedBy: { id: string; name: string };
  assignedAt: string;
  dueAt: string | null;
  note: string | null;
}

export interface ReportSummaryDto {
  id: string;
  reference: string;
  status: ReportStatus;
  priority: Priority;
  category: { id: string; name: string };
  address: string | null;
  latitude: number;
  longitude: number;
  photoCount: number;
  createdAt: string;
  updatedAt: string;
  /** Present for admin views only. */
  assignee?: { id: string; name: string } | null;
}

export interface ReportDetailDto extends ReportSummaryDto {
  description: string;
  media: MediaDto[];
  history: StatusHistoryDto[];
  assignment: AssignmentDto | null;
  validatedAt: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  /** Present for admin views only (privacy: field officers do not see this). */
  citizen?: { id: string; name: string; email: string | null; phone: string | null };
  /** Present for admin views only. Does not block validate or assign. */
  review?: ReportReviewDto;
}

/** An open report close enough to the one an administrator is reading. */
export interface NearbyOpenReportDto {
  id: string;
  reference: string;
  distanceMetres: number;
}

/**
 * Extra checks shown only to an administrator: another open report near this
 * spot, and how many other reports from this citizen were rejected.
 */
export interface ReportReviewDto {
  nearbyOpenReports: NearbyOpenReportDto[];
  rejectedReportCount: number;
}

/**
 * POST /reports. Sent as `multipart/form-data` when photos are attached (text
 * fields plus up to MAX_REPORT_PHOTOS files in the `photos` field) or as JSON
 * when there are none. Numbers may arrive as strings in multipart form data.
 */
export interface CreateReportRequest {
  categoryId: string;
  description: string;
  latitude: number;
  longitude: number;
  address?: string;
  /**
   * Client-generated unique key (UUID). Sending the same key twice returns the
   * original report instead of creating a duplicate (Chapter 4.6). The replay
   * carries the header `Idempotent-Replayed: true`.
   */
  idempotencyKey?: string;
}

/** The created report in full, so the app can show the success screen at once. */
export type CreateReportResponse = ReportDetailDto;

export interface ReportCountsDto {
  open: number;
  resolved: number;
}

export interface MyReportsQuery {
  status?: ReportStatus;
  /** Shortcut for the two dashboard groups (OPEN_REPORT_STATUSES / RESOLVED_REPORT_STATUSES). */
  group?: "open" | "resolved";
  page?: number;
  pageSize?: number;
}

export interface AssignReportRequest {
  assigneeId: string;
  dueAt?: string;
  note?: string;
}

export interface UpdateReportStatusRequest {
  status: ReportStatus;
  note?: string;
}

export interface UpdateReportPriorityRequest {
  priority: Priority;
}

export interface AdminReportFilters {
  status?: ReportStatus;
  categoryId?: string;
  priority?: Priority;
  assigneeId?: string;
  /** Free text: matches reference, description or address. */
  q?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

// ---------------------------------------------------------------------------
// Field tasks (FR-07)
// ---------------------------------------------------------------------------

/** One assignment for the signed-in field officer, with the full report. */
export interface TaskDto {
  assignmentId: string;
  assignmentStatus: AssignmentStatus;
  assignedAt: string;
  acknowledgedAt: string | null;
  completedAt: string | null;
  dueAt: string | null;
  /** Instruction from the administrator, if any. */
  note: string | null;
  assignedBy: { id: string; name: string };
  report: ReportDetailDto;
}

/** GET /tasks/my — "active" = PENDING or ACKNOWLEDGED, "completed" = COMPLETED. */
export interface MyTasksQuery {
  group?: "active" | "completed";
  page?: number;
  pageSize?: number;
}

export interface TaskCountsDto {
  active: number;
  completed: number;
}

export interface AcknowledgeTaskResponse {
  assignmentId: string;
  assignmentStatus: AssignmentStatus;
  acknowledgedAt: string | null;
}

// ---------------------------------------------------------------------------
// Notifications (FR-08)
// ---------------------------------------------------------------------------

export interface NotificationDto {
  id: string;
  message: string;
  read: boolean;
  createdAt: string;
  report: { id: string; reference: string } | null;
}

export interface UnreadCountDto {
  unread: number;
}

/** GET /notifications?unread=true&page=1&pageSize=20 */
export interface NotificationsQuery {
  unread?: boolean;
  page?: number;
  pageSize?: number;
}

export interface MarkAllReadResponse {
  /** How many notifications were changed from unread to read. */
  updated: number;
}

// ---------------------------------------------------------------------------
// Push notifications (FR-08 extension, Chapter 4.3.5): phones register their
// Firebase Cloud Messaging token so the API can alert them when the app is closed.
// ---------------------------------------------------------------------------

/** Android notification channel used for report updates. The app creates it; the API targets it. */
export const PUSH_ANDROID_CHANNEL_ID = "report-updates";

export type PushPlatform = "android" | "ios";

/** PUT /devices — register (or refresh) the signed-in user's device token. */
export interface RegisterDeviceRequest {
  /** Native FCM (Android) or APNs (iOS) device token. */
  token: string;
  platform: PushPlatform;
  /** App version, to help with support and clean-up. */
  appVersion?: string;
}

/** DELETE /devices — stop sending push notifications to this device (sign out). */
export interface UnregisterDeviceRequest {
  token: string;
}

/** Data attached to every push message, so the app can open the right screen. */
export interface PushMessageData {
  reportId?: string;
  reference?: string;
}

// ---------------------------------------------------------------------------
// Admin: users and stats (Chapter 4.4)
// ---------------------------------------------------------------------------

export interface CreateUserRequest {
  name: string;
  email?: string;
  phone?: string;
  password: string;
  role: Role;
}

export interface UpdateUserRequest {
  name?: string;
  role?: Role;
  status?: UserStatus;
}

export interface AdminStatsDto {
  byStatus: Record<ReportStatus, number>;
  total: number;
  /** Open reports older than 72 hours (Recommendation 5: ageing indicator). */
  ageingOpen: number;
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}
