export type AppCategory =
  | 'job'
  | 'court_block'
  | 'pan'
  | 'passport'
  | 'dl'
  | 'ticket'
  | 'hotel'
  | 'custom';

export interface CustomVaultField {
  id: string;
  label: string;
  value: string;
}

export interface ProfileVault {
  fullName: string;
  fatherName: string;
  motherName: string;
  dob: string;
  gender: string;
  category: string;
  maritalStatus: string;
  mobile: string;
  alternateMobile: string;
  email: string;
  addressLine: string;
  villageOrWard: string;
  postOffice: string;
  policeStation: string;
  blockOrTehsil: string;
  district: string;
  state: string;
  pinCode: string;
  qualification: string;
  boardOrUniversity: string;
  passingYear: string;
  percentageOrGrade: string;
  panNumber: string;
  aadhaarLast4: string;
  passportNumber: string;
  dlNumber: string;
  voterId: string;
  preferredDepartureCity: string;
  preferredTrainClass: string;
  bloodGroup: string;
  birthPlace: string;
  tenthBoard: string;
  tenthRoll: string;
  tenthYear: string;
  tenthPercent: string;
  twelfthBoard: string;
  twelfthRoll: string;
  twelfthYear: string;
  twelfthPercent: string;
  twelfthStream: string;
  graduationDegree: string;
  collegeName: string;
  graduationYear: string;
  graduationPercent: string;
  customFields: CustomVaultField[];
  updatedAt: string;
}

export interface ExtractedDocumentField {
  key: string;
  label: string;
  value: string;
}

export interface EphemeralDocumentExtract {
  id: string;
  fileName: string;
  documentType: string;
  summary: string;
  fields: ExtractedDocumentField[];
  extractedAt: string;
}

export interface FormFieldEntry {
  key: string;
  label: string;
  value: string;
  source: 'vault' | 'ai_inferred' | 'needs_input';
  notes?: string;
}

export interface GroundingSource {
  title: string;
  uri: string;
}

export interface ApplicationDraft {
  id: string;
  title: string;
  category: AppCategory;
  portalName: string;
  portalUrl: string;
  summary: string;
  status: 'draft_ready' | 'needs_review' | 'submitted_externally';
  fields: FormFieldEntry[];
  documentChecklist: string[];
  actionSteps: string[];
  formalLetterText?: string;
  humanVerificationNotes: string[];
  sources: GroundingSource[];
  createdAt: string;
  updatedAt: string;
}

export interface RequestedDocumentSpec {
  id: string;
  name: string;
  reason: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  sources?: GroundingSource[];
  linkedApplicationId?: string;
  suggestedUrl?: string;
  requestedDocuments?: RequestedDocumentSpec[];
  createdAt: string;
}

export interface PortalBookmark {
  id: string;
  name: string;
  category: AppCategory | 'general';
  url: string;
  description: string;
}

export interface BrowserInspectionResult {
  url: string;
  title: string;
  summary: string;
  detectedRequirements: string[];
  matchedVaultFields: { label: string; value: string }[];
  iframeLikelyBlocked: boolean;
  sources: GroundingSource[];
}

export interface FormDocumentRequirement {
  name: string;
  spec: string;
  whyNeeded: string;
}

export interface FormPageAnalysis {
  url: string;
  formTitle: string;
  isFormPage: boolean;
  summary: string;
  howToFillSteps: string[];
  requiredDocuments: FormDocumentRequirement[];
  feeAndDeadline: string;
  readyToFill: string[];
  missingFromUser: string[];
  humanOnlySteps: string[];
  nextBestAction: string;
  analyzedAt: string;
}

export interface WebSearchResultItem {
  title: string;
  url: string;
  snippet: string;
  isOfficialOrForm?: boolean;
}

export interface WebSearchResponse {
  query: string;
  answer: string;
  suggestedGoal?: string;
  results: WebSearchResultItem[];
}

export interface MissingFormField {
  id: string;
  key?: string;
  label: string;
  tag: string;
  type: string;
  placeholder?: string;
  options?: string[];
}

export interface LiveBrowserStatus {
  active: boolean;
  url: string;
  title: string;
  loading: boolean;
  adBlockEnabled: boolean;
  blockedAdsCount: number;
  tatkalMode?: boolean;
  tatkalStage?:
    | 'idle'
    | 'prewarm'
    | 'search'
    | 'train_list'
    | 'login_captcha'
    | 'passenger'
    | 'review_captcha'
    | 'otp'
    | 'payment'
    | 'blocked';
  viewportWidth: number;
  viewportHeight: number;
  agentRunning: boolean;
  agentStatus: string;
  waitingForHuman: boolean;
  humanPrompt: string | null;
  blockedReason?: string | null;
  filledCount?: number;
  requestedDocuments: RequestedDocumentSpec[];
  missingFields?: MissingFormField[];
  formAnalysis?: FormPageAnalysis | null;
  lastStepLogs: string[];
}

export interface ServiceCatalogItem {
  id: string;
  title: string;
  subtitle: string;
  category: AppCategory | 'admit_card' | 'result' | 'yojana' | 'tax_epf';
  actionLabel: string;
  iconLetter: string;
  tint: 'blue' | 'purple' | 'rose' | 'emerald' | 'indigo' | 'amber' | 'teal';
  directFormUrl: string;
  portalName: string;
  defaultFee: string;
  defaultProcessingTime: string;
  defaultEligibility: string;
  defaultDocuments: { name: string; reason: string }[];
  defaultFormGoal: string;
  badgeText?: string;
}

export interface ServiceBrief {
  serviceId: string;
  title: string;
  category: string;
  portalName: string;
  directFormUrl: string;
  feeSummary: string;
  processingTime: string;
  eligibilitySummary: string;
  keyHighlights: string[];
  requiredDocuments: { id: string; name: string; reason: string }[];
  formSteps: string[];
  humanCheckNotes: string;
  directFormGoal: string;
  sources: GroundingSource[];
  fromLiveAi: boolean;
}

export type CscDeskMode = 'land' | 'court_case' | 'lawyer_appointment' | 'resizer';

export interface CscRecommendedPortal {
  name: string;
  url: string;
  purpose: string;
}

export interface CscRequiredDoc {
  name: string;
  spec: string;
  purpose: string;
}

export interface CscLegalLandResponse {
  mode: 'land' | 'court_case' | 'lawyer_appointment';
  title: string;
  summary: string;
  portalName: string;
  portalUrl: string;
  browserGoal: string;
  feeAndTimeline: string;
  actionPlan: string[];
  primaryDraftTitle: string;
  primaryDraftText: string;
  secondaryDraftTitle: string;
  secondaryDraftText: string;
  requiredDocuments: CscRequiredDoc[];
  cautionNote: string;
  recommendedPortals: CscRecommendedPortal[];
  sources: GroundingSource[];
}

export interface WorkspaceBootstrap {
  profile: ProfileVault;
  applications: ApplicationDraft[];
  chatHistory: ChatMessage[];
  bookmarks: PortalBookmark[];
  aiConfigured: boolean;
  liveBrowserAvailable: boolean;
}

