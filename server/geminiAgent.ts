import {
  FunctionDeclaration,
  GoogleGenAI,
  Type,
  type Content,
  type GenerateContentResponse,
} from '@google/genai';
import crypto from 'crypto';
import type {
  AppCategory,
  ApplicationDraft,
  BrowserInspectionResult,
  ChatMessage,
  EphemeralDocumentExtract,
  ExtractedDocumentField,
  GroundingSource,
  ProfileVault,
  RequestedDocumentSpec,
  ServiceBrief,
  ServiceCatalogItem,
} from '../src/types.js';
import {
  buildFallbackServiceBrief,
  findServiceByIdOrQuery,
} from '../src/lib/serviceCatalog.js';
import { enrichExtractedFields } from '../src/lib/indianStates.js';

const PRIMARY_MODEL = 'gemini-4-hydrogen';
const FALLBACK_MODEL = 'gemini-3.1-flash-lite';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableQuotaOrTransient(error: unknown): boolean {
  const raw = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    raw.includes('resource_exhausted') ||
    raw.includes('429') ||
    raw.includes('rate limit') ||
    raw.includes('quota') ||
    raw.includes('unavailable') ||
    raw.includes('503')
  );
}

function isToolUnsupportedError(error: unknown): boolean {
  const raw = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    raw.includes('400') ||
    raw.includes('invalid_argument') ||
    raw.includes('not supported') ||
    raw.includes('tool')
  );
}

type GenerateParams = Omit<Parameters<GoogleGenAI['models']['generateContent']>[0], 'model'>;

async function generateContentResilient(
  ai: GoogleGenAI,
  params: GenerateParams
): Promise<GenerateContentResponse> {
  try {
    return await ai.models.generateContent({
      ...params,
      model: PRIMARY_MODEL,
    });
  } catch (err1) {
    if (!isRetryableQuotaOrTransient(err1)) {
      throw err1;
    }

    await sleep(1000);

    // Build a lighter-model compatible config by dropping urlContext first
    const origConfig = params.config ? { ...params.config } : undefined;
    if (origConfig && Array.isArray(origConfig.tools)) {
      const filteredTools = origConfig.tools.filter(
        (t) => !('urlContext' in (t as Record<string, unknown>))
      );
      if (filteredTools.length > 0) {
        origConfig.tools = filteredTools;
      } else {
        delete origConfig.tools;
        delete origConfig.toolConfig;
      }
    }

    try {
      return await ai.models.generateContent({
        ...params,
        model: FALLBACK_MODEL,
        config: origConfig,
      });
    } catch (err2) {
      if (origConfig?.tools && isToolUnsupportedError(err2)) {
        const fnOnlyTools = Array.isArray(origConfig.tools)
          ? origConfig.tools.filter((t) => 'functionDeclarations' in (t as Record<string, unknown>))
          : [];
        const safeConfig = { ...origConfig };
        delete safeConfig.toolConfig;
        if (fnOnlyTools.length > 0) {
          safeConfig.tools = fnOnlyTools;
        } else {
          delete safeConfig.tools;
        }
        return await ai.models.generateContent({
          ...params,
          model: FALLBACK_MODEL,
          config: safeConfig,
        });
      }
      throw err2;
    }
  }
}

export function isGeminiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim().length > 0);
}

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    const err = new Error(
      'Gemini API key is not configured. Please add GEMINI_API_KEY in Settings > Secrets.'
    ) as Error & { status?: number };
    err.status = 503;
    throw err;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export function formatGeminiError(error: unknown): { status: number; message: string } {
  const raw = error instanceof Error ? error.message : String(error);
  const lower = raw.toLowerCase();

  if (lower.includes('permission_denied') || lower.includes('api_key_invalid') || lower.includes('403') || lower.includes('400')) {
    return {
      status: 400,
      message: 'Gemini API authentication failed. Please check or select your API key in the Settings > Secrets panel.',
    };
  }
  if (lower.includes('resource_exhausted') || lower.includes('429')) {
    return {
      status: 429,
      message:
        'Gemini free-tier quota limit (429) hit ho gayi hai. Thodi der baad dubara try karein, ya Settings > Secrets me apna Gemini API key check/update karein.',
    };
  }
  if (lower.includes('not_found') || lower.includes('404')) {
    return {
      status: 502,
      message: `Gemini model error: ${raw}`,
    };
  }
  const status = (error as { status?: number })?.status;
  return {
    status: status && status >= 400 && status < 600 ? status : 500,
    message: raw || 'Failed to run Gemini AI request.',
  };
}

function extractGroundingSources(response: GenerateContentResponse): GroundingSource[] {
  const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
  if (!Array.isArray(chunks)) return [];
  const seen = new Set<string>();
  const sources: GroundingSource[] = [];
  for (const chunk of chunks) {
    const uri = chunk?.web?.uri;
    const title = chunk?.web?.title;
    if (uri && !seen.has(uri)) {
      seen.add(uri);
      sources.push({
        uri,
        title: title || uri,
      });
    }
  }
  return sources;
}

function serializeVaultContext(profile: ProfileVault): string {
  const entries: [string, string][] = [
    ['Full Name', profile.fullName],
    ['Father Name', profile.fatherName],
    ['Mother Name', profile.motherName],
    ['Date of Birth', profile.dob],
    ['Gender', profile.gender],
    ['Category', profile.category],
    ['Marital Status', profile.maritalStatus],
    ['Mobile', profile.mobile],
    ['Alternate Mobile', profile.alternateMobile],
    ['Email', profile.email],
    ['Address Line', profile.addressLine],
    ['Village/Ward', profile.villageOrWard],
    ['Post Office', profile.postOffice],
    ['Police Station', profile.policeStation],
    ['Block/Tehsil', profile.blockOrTehsil],
    ['District', profile.district],
    ['State', profile.state],
    ['PIN Code', profile.pinCode],
    ['Highest Qualification', profile.qualification],
    ['Board/University', profile.boardOrUniversity],
    ['Passing Year', profile.passingYear],
    ['Percentage/Grade', profile.percentageOrGrade],
    ['PAN Number', profile.panNumber],
    ['Aadhaar Last 4', profile.aadhaarLast4],
    ['Passport Number', profile.passportNumber],
    ['DL Number', profile.dlNumber],
    ['Voter ID', profile.voterId],
    ['Preferred Departure City', profile.preferredDepartureCity],
    ['Preferred Train Class', profile.preferredTrainClass],
    ['Blood Group', profile.bloodGroup],
    ['Place of Birth', profile.birthPlace],
    ['10th Board', profile.tenthBoard],
    ['10th Roll No', profile.tenthRoll],
    ['10th Passing Year', profile.tenthYear],
    ['10th Percentage', profile.tenthPercent],
    ['12th Board', profile.twelfthBoard],
    ['12th Roll No', profile.twelfthRoll],
    ['12th Passing Year', profile.twelfthYear],
    ['12th Percentage', profile.twelfthPercent],
    ['12th Stream', profile.twelfthStream],
    ['Graduation Degree', profile.graduationDegree],
    ['College / University', profile.collegeName],
    ['Graduation Year', profile.graduationYear],
    ['Graduation Percentage', profile.graduationPercent],
  ];

  const populated = entries
    .filter(([, val]) => val && val.trim().length > 0)
    .map(([k, v]) => `- ${k}: ${v}`);

  const custom = (profile.customFields || [])
    .filter((f) => f.label.trim() && f.value.trim())
    .map((f) => `- ${f.label}: ${f.value}`);

  if (populated.length === 0 && custom.length === 0) {
    return 'Profile Vault is currently mostly empty. Ask the user or mark missing fields as needs_input.';
  }
  return [...populated, ...custom].join('\n');
}

function serializeCombinedUserContext(
  profile: ProfileVault,
  ephemeralDocs?: EphemeralDocumentExtract[]
): string {
  const vaultStr = serializeVaultContext(profile);
  if (!ephemeralDocs || ephemeralDocs.length === 0) return vaultStr;
  const docLines = ephemeralDocs.flatMap((doc) => [
    `[Document: ${doc.documentType} (${doc.fileName}) - Ephemeral RAM Only]`,
    ...doc.fields.map((f) => `- ${f.label}: ${f.value}`),
  ]);
  return `${vaultStr}\n\nEPHEMERAL OCR DOCUMENT DETAILS (USE FOR FORM FILLING, DO NOT PERSIST):\n${docLines.join('\n')}`;
}

const createApplicationDraftDecl: FunctionDeclaration = {
  name: 'create_application_draft',
  description:
    'Save a structured, auto-filled application form, court/block letter, government ID checklist (PAN/Passport/DL), job application draft, or ticket/hotel itinerary into the user workspace.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      title: { type: Type.STRING, description: 'Clear title of the application or booking plan.' },
      category: {
        type: Type.STRING,
        description:
          'One of: job, court_block, pan, passport, dl, ticket, hotel, custom',
      },
      portalName: { type: Type.STRING, description: 'Official portal or service name.' },
      portalUrl: { type: Type.STRING, description: 'Official HTTPS URL for the portal.' },
      summary: { type: Type.STRING, description: 'Short summary of what was prepared.' },
      formalLetterText: {
        type: Type.STRING,
        description:
          'Complete ready-to-print/copy formal application letter if applicable (e.g., for Court, Kachahari, Block, Tehsil, Job cover letter).',
      },
      fieldsJson: {
        type: Type.STRING,
        description:
          'JSON array string of objects: [{"key":"fullName","label":"Applicant Name","value":"...","source":"vault|ai_inferred|needs_input"}]',
      },
      documentChecklist: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description: 'List of required documents to upload or carry.',
      },
      actionSteps: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description: 'Ordered steps to complete submission on the official portal.',
      },
      humanVerificationNotes: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description:
          'Steps that require the user personally (e.g., Aadhaar OTP, CAPTCHA, biometric slot, final payment).',
      },
    },
    required: ['title', 'category', 'portalName', 'portalUrl', 'summary', 'fieldsJson'],
  },
};

const openMiniBrowserDecl: FunctionDeclaration = {
  name: 'open_mini_browser',
  description:
    'Suggest or load an official portal URL inside the app built-in Mini Browser so the user can review or complete OTP/CAPTCHA/payment.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      url: { type: Type.STRING, description: 'Full HTTPS URL to open in Mini Browser.' },
      reason: { type: Type.STRING, description: 'Why this URL is being opened.' },
    },
    required: ['url'],
  },
};

const requestRequiredDocumentsDecl: FunctionDeclaration = {
  name: 'request_required_documents',
  description:
    'Ask the user to upload ONLY the specific documents needed for their requested service/website (e.g. for Passport: Aadhaar Card + 10th Marksheet; for Army: 10th Marksheet + Aadhaar + Domicile; for unknown website: the exact docs listed on that site) so OCR+AI can extract details and fill the form.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      documents: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            name: {
              type: Type.STRING,
              description: 'Document name, e.g. "Aadhaar Card" or "10th Marksheet"',
            },
            reason: {
              type: Type.STRING,
              description: 'Why this document is needed for this specific form',
            },
          },
          required: ['name', 'reason'],
        },
      },
    },
    required: ['documents'],
  },
};

export interface LiveAgentResult {
  replyText: string;
  sources: GroundingSource[];
  createdDraft?: ApplicationDraft;
  suggestedUrl?: string;
  requestedDocuments?: RequestedDocumentSpec[];
}

export async function runLiveAgentChat(params: {
  prompt: string;
  profile: ProfileVault;
  ephemeralDocs?: EphemeralDocumentExtract[];
  recentHistory: ChatMessage[];
  onSaveDraft: (draftInput: Omit<ApplicationDraft, 'id' | 'createdAt' | 'updatedAt'>) => ApplicationDraft;
}): Promise<LiveAgentResult> {
  const ai = getGeminiClient();
  const vaultSummary = serializeCombinedUserContext(params.profile, params.ephemeralDocs);
  const historySlice = params.recentHistory
    .slice(-6)
    .map((m) => `${m.role === 'user' ? 'User' : 'SarthiAI'}: ${m.text}`)
    .join('\n');

  const systemInstruction = [
    'You are SarthiAI, an autonomous Indian personal assistant with live Google Search internet access, URL reading, and OCR+AI document extraction.',
    'Language style: Match the user language naturally (clear Hinglish / Hindi / English as used by the user).',
    'Capabilities & Workflow:',
    '1. Search live internet (or inspect the given website URL using urlContext) to check the EXACT requirements, eligibility, and documents needed for the user task (e.g., Passport, Join Indian Army, PAN, Driving License, SSC Job, IRCTC Ticket/Account, Court/Block application, or ANY third-party website).',
    '2. DOCUMENT-FIRST RULE: If the user asks to apply for something (like Passport, Army, Job, PAN, DL, or a specific website) AND their USER PROFILE VAULT / EPHEMERAL OCR DOCUMENTS do not yet contain the required details/documents for that specific service, ALWAYS call `request_required_documents` listing ONLY the exact documents needed for THAT task (so inline upload buttons appear right in your reply!).',
    '3. If the user HAS ALREADY provided the required document(s) in EPHEMERAL OCR DOCUMENT DETAILS or Profile Vault, immediately call `create_application_draft` with every field auto-filled from their OCR details/Vault, AND call `open_mini_browser` with the official verified HTTPS URL.',
    '4. Honesty rule: Never claim you already bypassed CAPTCHA, OTP, Aadhaar e-Sign, or paid money on external portals. Clearly explain what you prepared automatically and where the user will enter OTP/CAPTCHA/payment in the Live Browser.',
    '',
    'USER DETAILS AVAILABLE RIGHT NOW:',
    vaultSummary,
  ].join('\n');

  const fullUserPrompt = historySlice
    ? `Recent conversation:\n${historySlice}\n\nCurrent user request:\n${params.prompt}`
    : params.prompt;

  const tools = [
    { googleSearch: {} },
    { urlContext: {} },
    {
      functionDeclarations: [
        requestRequiredDocumentsDecl,
        createApplicationDraftDecl,
        openMiniBrowserDecl,
      ],
    },
  ];
  const toolConfig = { includeServerSideToolInvocations: true };

  const contents: Content[] = [{ role: 'user', parts: [{ text: fullUserPrompt }] }];

  const response1 = await generateContentResilient(ai, {
    contents,
    config: {
      systemInstruction,
      tools,
      toolConfig,
    },
  });

  const collectedSources = new Map<string, GroundingSource>();
  for (const s of extractGroundingSources(response1)) {
    collectedSources.set(s.uri, s);
  }

  let createdDraft: ApplicationDraft | undefined;
  let suggestedUrl: string | undefined;
  let requestedDocuments: RequestedDocumentSpec[] | undefined;

  const functionCalls = response1.functionCalls;
  const previousContent = response1.candidates?.[0]?.content;

  if (functionCalls && functionCalls.length > 0 && previousContent) {
    const functionResponseParts = [];

    for (const fc of functionCalls) {
      if (fc.name === 'request_required_documents') {
        const args = (fc.args || {}) as {
          documents?: { name?: string; reason?: string }[];
        };
        const docs = Array.isArray(args.documents)
          ? args.documents
              .map((d, idx) => ({
                id: `reqdoc-${idx + 1}-${crypto.randomBytes(2).toString('hex')}`,
                name: String(d.name || '').trim(),
                reason: String(d.reason || '').trim(),
              }))
              .filter((d) => d.name.length > 0)
          : [];
        if (docs.length > 0) {
          requestedDocuments = docs;
        }
        functionResponseParts.push({
          functionResponse: {
            id: fc.id,
            name: fc.name,
            response: { ok: true, requestedCount: docs.length },
          },
        });
      } else if (fc.name === 'create_application_draft') {
        const args = (fc.args || {}) as Record<string, unknown>;
        let parsedFields: ApplicationDraft['fields'] = [];
        try {
          const rawFields = typeof args.fieldsJson === 'string' ? JSON.parse(args.fieldsJson) : [];
          if (Array.isArray(rawFields)) {
            parsedFields = rawFields.map((f, idx) => ({
              key: String(f.key || `field_${idx + 1}`),
              label: String(f.label || `Field ${idx + 1}`),
              value: String(f.value ?? ''),
              source:
                f.source === 'vault' || f.source === 'ai_inferred' || f.source === 'needs_input'
                  ? f.source
                  : 'ai_inferred',
            }));
          }
        } catch {
          parsedFields = [];
        }

        const validCategories: AppCategory[] = [
          'job',
          'court_block',
          'pan',
          'passport',
          'dl',
          'ticket',
          'hotel',
          'custom',
        ];
        const rawCat = String(args.category || 'custom');
        const category: AppCategory = validCategories.includes(rawCat as AppCategory)
          ? (rawCat as AppCategory)
          : 'custom';

        const portalUrl = String(args.portalUrl || 'https://www.india.gov.in');
        createdDraft = params.onSaveDraft({
          title: String(args.title || 'AI Prepared Application'),
          category,
          portalName: String(args.portalName || 'Official Portal'),
          portalUrl,
          summary: String(args.summary || 'Auto-filled draft prepared from Profile Vault.'),
          status: parsedFields.some((f) => f.source === 'needs_input' || !f.value.trim())
            ? 'needs_review'
            : 'draft_ready',
          fields: parsedFields,
          documentChecklist: Array.isArray(args.documentChecklist)
            ? args.documentChecklist.map(String)
            : [],
          actionSteps: Array.isArray(args.actionSteps) ? args.actionSteps.map(String) : [],
          formalLetterText: args.formalLetterText ? String(args.formalLetterText) : undefined,
          humanVerificationNotes: Array.isArray(args.humanVerificationNotes)
            ? args.humanVerificationNotes.map(String)
            : ['Verify OTP, CAPTCHA, and final submission/payment on the official portal.'],
          sources: Array.from(collectedSources.values()),
        });

        if (!suggestedUrl && portalUrl.startsWith('http')) {
          suggestedUrl = portalUrl;
        }

        functionResponseParts.push({
          functionResponse: {
            id: fc.id,
            name: fc.name,
            response: {
              ok: true,
              applicationId: createdDraft.id,
              title: createdDraft.title,
              fieldsCount: createdDraft.fields.length,
            },
          },
        });
      } else if (fc.name === 'open_mini_browser') {
        const args = (fc.args || {}) as Record<string, unknown>;
        const url = String(args.url || '');
        if (url.startsWith('http')) {
          suggestedUrl = url;
        }
        functionResponseParts.push({
          functionResponse: {
            id: fc.id,
            name: fc.name,
            response: { ok: true, queuedUrl: suggestedUrl || url },
          },
        });
      }
    }

    if (functionResponseParts.length > 0) {
      let replyText = '';
      try {
        const response2 = await generateContentResilient(ai, {
          contents: [
            ...contents,
            previousContent,
            { role: 'user', parts: functionResponseParts },
          ],
          config: {
            systemInstruction,
            tools,
            toolConfig,
          },
        });
        for (const s of extractGroundingSources(response2)) {
          collectedSources.set(s.uri, s);
        }
        replyText = response2.text?.trim() || '';
      } catch {
        // Turn 1 actions already succeeded; preserve results with a clear fallback summary
        replyText = '';
      }

      if (!replyText) {
        if (requestedDocuments && requestedDocuments.length > 0) {
          replyText =
            'Is kaam ke liye niche diye gaye documents upload karein. OCR se details nikal kar main form auto-fill kar dunga (Zero-Save mode — kuch save nahi hoga):';
        } else if (createdDraft) {
          replyText = `Aapka "${createdDraft.title}" draft auto-fill ho gaya hai! Aap "View Auto-Filled Form" par click karke details dekh sakte hain ya "Run Live in Browser" se portal par ja sakte hain.`;
        } else {
          replyText =
            'Action taiyaar hai. Aap Live Browser me official portal khol sakte hain.';
        }
      }

      return {
        replyText,
        sources: Array.from(collectedSources.values()),
        createdDraft,
        suggestedUrl,
        requestedDocuments,
      };
    }
  }

  return {
    replyText:
      response1.text?.trim() ||
      'Main aapki madad ke liye ready hoon. Kripya apni request thoda aur detail me batayein.',
    sources: Array.from(collectedSources.values()),
    createdDraft,
    suggestedUrl,
    requestedDocuments,
  };
}

export async function generateAutoFilledApplication(params: {
  category: AppCategory;
  goal: string;
  targetUrl?: string;
  language?: 'hinglish' | 'hindi' | 'english';
  profile: ProfileVault;
  ephemeralDocs?: EphemeralDocumentExtract[];
}): Promise<Omit<ApplicationDraft, 'id' | 'createdAt' | 'updatedAt'>> {
  const ai = getGeminiClient();
  const vaultSummary = serializeCombinedUserContext(params.profile, params.ephemeralDocs);

  // Step 1: Live internet research using Google Search + optional URL Context
  const researchPrompt = [
    `Research the official Indian portal, exact current procedure, required form fields, fee details, and document list for:`,
    `Category: ${params.category}`,
    `User Goal: ${params.goal}`,
    params.targetUrl ? `Specific Portal URL to inspect: ${params.targetUrl}` : '',
    `Return verified official HTTPS portal URL, portal name, key requirements, and live details found.`,
  ]
    .filter(Boolean)
    .join('\n');

  let sources: GroundingSource[] = [];
  let researchNotes = '';
  try {
    const researchResponse = await generateContentResilient(ai, {
      contents: researchPrompt,
      config: {
        tools: params.targetUrl
          ? [{ googleSearch: {} }, { urlContext: {} }]
          : [{ googleSearch: {} }],
      },
    });
    sources = extractGroundingSources(researchResponse);
    researchNotes = researchResponse.text?.trim() || '';
  } catch {
    researchNotes = `Use verified Indian official portal details for category=${params.category}, goal="${params.goal}".`;
  }

  // Step 2: Structured JSON generation grounded on research + Profile Vault
  const langInstruction =
    params.language === 'hindi'
      ? 'Write formalLetterText in clean formal Hindi (Devanagari) when applicable (court/kachahari/block applications), and clear Hindi/Hinglish labels.'
      : params.language === 'english'
      ? 'Write all content and formalLetterText in crisp formal English.'
      : 'Write summaries and steps in clear Hinglish/English, and formalLetterText in clean formal Hindi/English appropriate for Indian offices.';

  const structuredPrompt = [
    `Generate a complete auto-filled application draft for the user.`,
    langInstruction,
    `Category: ${params.category}`,
    `Goal: ${params.goal}`,
    params.targetUrl ? `Target URL: ${params.targetUrl}` : '',
    '',
    'LIVE WEB RESEARCH:',
    researchNotes,
    '',
    'USER PROFILE VAULT:',
    vaultSummary,
    '',
    'Rules:',
    '- Populate every possible field from USER PROFILE VAULT and mark source="vault".',
    '- Infer sensible defaults from the goal (e.g. destination city, application type) and mark source="ai_inferred".',
    '- If a critical field is missing in the vault (such as exact travel date or Aadhaar/PAN if blank), set value="" and source="needs_input" with helpful notes.',
    '- Include a complete ready-to-print formalLetterText for court/kachahari/block/job applications (or booking summary/request text for other categories).',
    '- In humanVerificationNotes, honestly list steps like OTP, CAPTCHA, Aadhaar e-Sign, biometric appointment, or payment checkout that the user must confirm in the Mini Browser.',
  ].join('\n');

  const structuredResponse = await generateContentResilient(ai, {
    contents: structuredPrompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          portalName: { type: Type.STRING },
          portalUrl: { type: Type.STRING },
          summary: { type: Type.STRING },
          formalLetterText: { type: Type.STRING },
          fields: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                key: { type: Type.STRING },
                label: { type: Type.STRING },
                value: { type: Type.STRING },
                source: { type: Type.STRING },
                notes: { type: Type.STRING },
              },
              required: ['key', 'label', 'value', 'source'],
            },
          },
          documentChecklist: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
          actionSteps: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
          humanVerificationNotes: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
        },
        required: [
          'title',
          'portalName',
          'portalUrl',
          'summary',
          'fields',
          'documentChecklist',
          'actionSteps',
          'humanVerificationNotes',
        ],
      },
    },
  });

  const parsed = JSON.parse((structuredResponse.text ?? '{}').trim()) as Partial<ApplicationDraft>;
  const fields = Array.isArray(parsed.fields)
    ? parsed.fields.map((f, idx) => ({
        key: String(f.key || `field_${idx + 1}`),
        label: String(f.label || `Field ${idx + 1}`),
        value: String(f.value ?? ''),
        source: (f.source === 'vault' || f.source === 'ai_inferred' || f.source === 'needs_input'
          ? f.source
          : 'ai_inferred') as 'vault' | 'ai_inferred' | 'needs_input',
        notes: f.notes ? String(f.notes) : undefined,
      }))
    : [];

  const needsReview = fields.some((f) => f.source === 'needs_input' || !f.value.trim());

  return {
    title: String(parsed.title || params.goal),
    category: params.category,
    portalName: String(parsed.portalName || 'Official Portal'),
    portalUrl: String(parsed.portalUrl || params.targetUrl || 'https://www.india.gov.in'),
    summary: String(parsed.summary || 'Application draft prepared.'),
    status: needsReview ? 'needs_review' : 'draft_ready',
    fields,
    documentChecklist: Array.isArray(parsed.documentChecklist)
      ? parsed.documentChecklist.map(String)
      : [],
    actionSteps: Array.isArray(parsed.actionSteps) ? parsed.actionSteps.map(String) : [],
    formalLetterText: parsed.formalLetterText ? String(parsed.formalLetterText) : undefined,
    humanVerificationNotes: Array.isArray(parsed.humanVerificationNotes)
      ? parsed.humanVerificationNotes.map(String)
      : ['Verify OTP, CAPTCHA, and payment directly on the official portal.'],
    sources,
  };
}

export async function inspectUrlWithAI(params: {
  url: string;
  profile: ProfileVault;
}): Promise<BrowserInspectionResult> {
  let iframeLikelyBlocked = false;
  let fetchedTitle = '';

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4500);
    const res = await fetch(params.url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36',
      },
    });
    clearTimeout(timer);

    const xfo = res.headers.get('x-frame-options')?.toLowerCase() || '';
    const csp = res.headers.get('content-security-policy')?.toLowerCase() || '';
    if (
      xfo.includes('deny') ||
      xfo.includes('sameorigin') ||
      (csp.includes('frame-ancestors') && !csp.includes('frame-ancestors *'))
    ) {
      iframeLikelyBlocked = true;
    }
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('text/html')) {
      const html = await res.text();
      const titleMatch = html.match(/<title[^>]*>([^<]{1,180})<\/title>/i);
      if (titleMatch) {
        fetchedTitle = titleMatch[1].trim().replace(/\s+/g, ' ');
      }
    }
  } catch {
    // Network or TLS mismatch; let Gemini urlContext/googleSearch inspect cleanly
  }

  const ai = getGeminiClient();
  const vaultSummary = serializeVaultContext(params.profile);

  let sources: GroundingSource[] = [];
  let rawPageNotes = fetchedTitle || params.url;
  try {
    const webReadResponse = await generateContentResilient(ai, {
      contents: [
        `Inspect this portal URL and explain what services, forms, eligibility, or booking options exist here: ${params.url}`,
        fetchedTitle ? `Detected HTML title: ${fetchedTitle}` : '',
        'List the main form inputs, documents, and actions a user needs on this page.',
      ]
        .filter(Boolean)
        .join('\n'),
      config: {
        tools: [{ urlContext: {} }, { googleSearch: {} }],
      },
    });
    sources = extractGroundingSources(webReadResponse);
    rawPageNotes = webReadResponse.text?.trim() || fetchedTitle || params.url;
  } catch {
    // Fallback cleanly using fetched title/URL
  }

  const extractResponse = await generateContentResilient(ai, {
    contents: [
      `URL: ${params.url}`,
      fetchedTitle ? `Page Title: ${fetchedTitle}` : '',
      `Page Notes:\n${rawPageNotes}`,
      '',
      `USER PROFILE VAULT:\n${vaultSummary}`,
      '',
      'Extract a concise summary (in Hinglish/English), list of key required form fields/documents, and matching fields from USER PROFILE VAULT that the user can copy-paste onto this portal.',
    ]
      .filter(Boolean)
      .join('\n'),
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          summary: { type: Type.STRING },
          detectedRequirements: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
          matchedVaultFields: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                label: { type: Type.STRING },
                value: { type: Type.STRING },
              },
              required: ['label', 'value'],
            },
          },
        },
        required: ['title', 'summary', 'detectedRequirements', 'matchedVaultFields'],
      },
    },
  });

  let parsed: Partial<BrowserInspectionResult> = {};
  try {
    parsed = JSON.parse((extractResponse.text ?? '{}').trim());
  } catch {
    parsed = {
      title: fetchedTitle || params.url,
      summary: rawPageNotes,
      detectedRequirements: [],
      matchedVaultFields: [],
    };
  }

  return {
    url: params.url,
    title: String(parsed.title || fetchedTitle || params.url),
    summary: String(parsed.summary || rawPageNotes),
    detectedRequirements: Array.isArray(parsed.detectedRequirements)
      ? parsed.detectedRequirements.map(String)
      : [],
    matchedVaultFields: Array.isArray(parsed.matchedVaultFields)
      ? parsed.matchedVaultFields
          .map((m) => ({
            label: String(m.label || ''),
            value: String(m.value || ''),
          }))
          .filter((m) => m.label && m.value)
      : [],
    iframeLikelyBlocked,
    sources,
  };
}

export async function extractDocumentWithOCR(params: {
  buffer: Buffer;
  mimeType: string;
  fileName: string;
}): Promise<EphemeralDocumentExtract> {
  const ai = getGeminiClient();
  const base64Data = params.buffer.toString('base64');

  const response = await generateContentResilient(ai, {
    contents: {
      parts: [
        {
          inlineData: {
            mimeType: params.mimeType,
            data: base64Data,
          },
        },
        {
          text: [
            'Perform exact OCR and AI structured extraction on this uploaded Indian document (Aadhaar Card, PAN, Marksheet, Army/NCC Certificate, Domicile/Caste/Income Certificate, Passport, or Driving License).',
            'Extract EVERY visible detail accurately without guessing or inventing values.',
            'IMPORTANT FOR AADHAAR & ADDRESS DOCUMENTS: Always extract the Indian State/UT (`state`) in canonical English (e.g., "Bihar", "Uttar Pradesh", "Maharashtra", "Delhi", "Jharkhand", "Rajasthan", "West Bengal") from the address or PIN code, even if the card prints it in Hindi or inside the full address block. Also separate `district`, `blockOrTehsil`, `villageOrWard`, `postOffice`, `policeStation`, `pinCode`, and `addressLine`.',
            'For `dob`, prefer YYYY-MM-DD format if full date is visible (or DD/MM/YYYY if only year/partial).',
            'Include standard keys where visible: fullName, fatherName, motherName, dob, gender, category, mobile, email, addressLine, villageOrWard, postOffice, policeStation, blockOrTehsil, district, state, pinCode, qualification, boardOrUniversity, passingYear, rollNumber, percentageOrGrade, panNumber, aadhaarNumber, passportNumber, dlNumber, voterId, heightCm, certificateNumber.',
          ].join('\n'),
        },
      ],
    },
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          documentType: { type: Type.STRING },
          summary: { type: Type.STRING },
          fields: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                key: { type: Type.STRING },
                label: { type: Type.STRING },
                value: { type: Type.STRING },
              },
              required: ['key', 'label', 'value'],
            },
          },
        },
        required: ['documentType', 'summary', 'fields'],
      },
    },
  });

  const parsed = JSON.parse((response.text ?? '{}').trim()) as {
    documentType?: string;
    summary?: string;
    fields?: ExtractedDocumentField[];
  };

  const rawFields = Array.isArray(parsed.fields)
    ? parsed.fields
        .map((f, idx) => ({
          key: String(f.key || `field_${idx + 1}`),
          label: String(f.label || `Field ${idx + 1}`),
          value: String(f.value || '').trim(),
        }))
        .filter((f) => f.value.length > 0)
    : [];

  return {
    id: `doc-${crypto.randomBytes(4).toString('hex')}`,
    fileName: params.fileName,
    documentType: String(parsed.documentType || 'Uploaded Document'),
    summary: String(parsed.summary || 'Document details extracted via OCR + AI.'),
    fields: enrichExtractedFields(rawFields),
    extractedAt: new Date().toISOString(),
  };
}

export interface InteractiveDomElement {
  index: number;
  frameIndex?: number;
  tag: string;
  type: string;
  label: string;
  nearbyText: string;
  placeholder: string;
  value: string;
  checked?: boolean;
  options?: string[];
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LiveBrowserStepDecision {
  action:
    | 'navigate'
    | 'click'
    | 'fill'
    | 'select'
    | 'press_key'
    | 'scroll'
    | 'request_documents'
    | 'pause_for_human'
    | 'done';
  elementIndex?: number;
  x?: number;
  y?: number;
  value?: string;
  reason: string;
  humanPrompt?: string;
  neededDocuments?: { name: string; reason: string }[];
}

export async function decideLiveBrowserStep(params: {
  screenshotBase64: string;
  currentUrl: string;
  pageTitle: string;
  pageTextSnippet: string;
  goal: string;
  interactiveElements: InteractiveDomElement[];
  profile: ProfileVault;
  ephemeralDocs?: EphemeralDocumentExtract[];
  stepHistory: string[];
}): Promise<LiveBrowserStepDecision> {
  const ai = getGeminiClient();
  const userContext = serializeCombinedUserContext(params.profile, params.ephemeralDocs);
  const domSnippet = params.interactiveElements
    .slice(0, 75)
    .map((el) => {
      const opts =
        el.options && el.options.length > 0
          ? ` options=[${el.options.slice(0, 12).join(' | ')}]`
          : '';
      const chk = typeof el.checked === 'boolean' ? ` checked=${el.checked}` : '';
      const fTag = el.frameIndex && el.frameIndex > 0 ? ` frame=${el.frameIndex}` : '';
      return `[${el.index}]${fTag} <${el.tag}${el.type ? ` type=${el.type}` : ''}> center=(${Math.round(
        el.x
      )},${Math.round(el.y)}) label="${el.label}" nearby="${el.nearbyText}" placeholder="${
        el.placeholder
      }" val="${el.value}"${chk}${opts}`;
    })
    .join('\n');

  const prompt = [
    'You are a Universal OCR + AI Vision Web Browser Copilot controlling a live Desktop Chromium page visible to the user on ANY website.',
    `USER GOAL: ${params.goal}`,
    `CURRENT URL: ${params.currentUrl}`,
    `PAGE TITLE: ${params.pageTitle}`,
    '',
    'PAGE VISIBLE TEXT SUMMARY:',
    params.pageTextSnippet || '(no text extracted)',
    '',
    'USER DETAILS AVAILABLE RIGHT NOW (OCR DOCUMENTS / PROFILE):',
    userContext,
    '',
    'RECENT STEPS TAKEN:',
    params.stepHistory.slice(-8).join('\n') || 'None yet.',
    '',
    'INTERACTIVE ELEMENTS ON THIS WEBSITE (TARGET BY `elementIndex` + `(x, y)`):',
    domSnippet || 'No interactive elements extracted.',
    '',
    'UNIVERSAL WEBSITE RULES (3-TO-10 PAGE FORMS, SSC/UPSC/JOBS, PAN/DL/PASSPORT, IRCTC TICKETS):',
    '1. Look carefully at the live screenshot, PAGE VISIBLE TEXT SUMMARY, and INTERACTIVE ELEMENTS (including inside iframes).',
    '2. WELCOME / NOTICE POPUPS: If a portal advisory dialog ("OK", "Close", "Skip", "I Understand", "×") covers the page, click it first so the underlying form or Apply button is reachable.',
    '3. AUTO-CLICK APPLY / FORM / NEXT RULE: Never stay stuck on a homepage or notice page! When buttons/links like "Apply Online", "Apply Now", "New Registration", "One Time Registration", "Register", "Save & Next", "Submit & Next", "Continue", "Proceed", or "Search Trains" (when required fields on current step are filled) are ready, return action="click" on that element.',
    '4. CUSTOM DROPDOWNS & AUTOCOMPLETE (SSC OTR, ANGULAR, IRCTC): Many portals use custom <div>/<mat-select>/<ng-select>/<p-dropdown>/<p-autocomplete> showing "Select", "Choose", or station suggestions instead of native <select>. If an element shows "Select" or has role="combobox", you can return action="select" with value="<exact option text>", OR click it first so options appear and then click the matching option on the next step. For IRCTC From/To stations, first "fill" the station name/code, then on the next step click the matching station suggestion from the popup list before clicking "Search Trains".',
    '5. VERIFY / CONFIRM PAIRS: Forms like SSC OTR ask both "Gender" & "Verify Gender", or "10th Education Board" & "Verify Education Board", or "Aadhaar" & "Verify Aadhaar". Fill/select BOTH the primary field and the Verify field accurately.',
    '6. LOGIN CREDENTIALS: ONLY if Login User ID / Username & Password fields are visible AND the user explicitly provided Login User ID / Password in USER DETAILS, fill them and click Login/Sign In (provided no CAPTCHA is blocking). Never invent or guess credentials.',
    '7. STATE & ADDRESS RULE: If the page asks for State / Rajya / UT and user address/PIN code is present in USER DETAILS, always select the matching Indian State (e.g. PIN 80-85 = Bihar/Jharkhand, 20-28 = Uttar Pradesh, 11 = Delhi, 40-44 = Maharashtra).',
    '8. DYNAMIC DOCUMENT REQUEST RULE: Only if visible form fields require documents/details missing from USER DETAILS AVAILABLE RIGHT NOW, return action="request_documents" with `neededDocuments`. Otherwise fill every available field first.',
    '9. For empty `<input>` / `<textarea>`, return action="fill" with BOTH `elementIndex` and `(x, y)`, plus exact text in `value`.',
    '10. For dropdowns (`<select>`, `mat-select`, `ng-select`, `p-dropdown`, `[role="combobox"]`, "Select" triggers), return action="select" with `elementIndex`, `(x, y)`, and the matching option label in `value`.',
    '11. For buttons, tabs, links, autocomplete suggestions, checkboxes, or radio buttons, return action="click" with `elementIndex` and `(x, y)`.',
    '12. STRICT HUMAN-IN-THE-LOOP SAFETY RULE: If you see ANY CAPTCHA image/input, "I am not a robot" / reCAPTCHA checkbox, OTP box, Aadhaar e-Sign, file upload `<input type="file">`, new password creation, or Final Payment / Pay Now / Final Submit button, NEVER attempt to read/solve CAPTCHA or click "I am not a robot" or guess OTP/payment! Immediately return action="pause_for_human" with a clear Hinglish `humanPrompt` asking the user to complete CAPTCHA / robot check / OTP / payment directly on the screen.',
    '13. If required fields or the Next/Continue button are below the fold, return action="scroll" with value="down" or "up".',
    '14. Return action="done" only when the visible multi-page application/booking stage reaches confirmation or all non-human fields are completed.',
  ].join('\n');

  const response = await generateContentResilient(ai, {
    contents: {
      parts: [
        {
          inlineData: {
            mimeType: 'image/jpeg',
            data: params.screenshotBase64,
          },
        },
        { text: prompt },
      ],
    },
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          action: { type: Type.STRING },
          elementIndex: { type: Type.INTEGER },
          x: { type: Type.NUMBER },
          y: { type: Type.NUMBER },
          value: { type: Type.STRING },
          reason: { type: Type.STRING },
          humanPrompt: { type: Type.STRING },
          neededDocuments: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                reason: { type: Type.STRING },
              },
              required: ['name', 'reason'],
            },
          },
        },
        required: ['action', 'reason'],
      },
    },
  });

  const parsed = JSON.parse((response.text ?? '{}').trim()) as Partial<LiveBrowserStepDecision>;
  const validActions = new Set([
    'navigate',
    'click',
    'fill',
    'select',
    'press_key',
    'scroll',
    'request_documents',
    'pause_for_human',
    'done',
  ]);
  const action = validActions.has(String(parsed.action))
    ? (parsed.action as LiveBrowserStepDecision['action'])
    : 'pause_for_human';

  return {
    action,
    elementIndex: typeof parsed.elementIndex === 'number' ? parsed.elementIndex : undefined,
    x: typeof parsed.x === 'number' ? parsed.x : undefined,
    y: typeof parsed.y === 'number' ? parsed.y : undefined,
    value: typeof parsed.value === 'string' ? parsed.value : undefined,
    reason: String(parsed.reason || 'Analyzing live screen'),
    humanPrompt: parsed.humanPrompt ? String(parsed.humanPrompt) : undefined,
    neededDocuments: Array.isArray(parsed.neededDocuments)
      ? parsed.neededDocuments
          .map((d) => ({ name: String(d.name || ''), reason: String(d.reason || '') }))
          .filter((d) => d.name.length > 0)
      : undefined,
  };
}

export async function getServiceBriefWithAI(params: {
  serviceId?: string;
  query: string;
}): Promise<ServiceBrief> {
  const catalogItem: ServiceCatalogItem | null = findServiceByIdOrQuery(
    params.serviceId,
    params.query
  );
  const fallback = buildFallbackServiceBrief(params.query, catalogItem);

  if (!isGeminiConfigured()) {
    return fallback;
  }

  try {
    const ai = getGeminiClient();
    const researchPrompt = [
      `Find exact live Indian portal details for user request: "${params.query}"`,
      catalogItem ? `Known portal: ${catalogItem.portalName} (${catalogItem.directFormUrl})` : '',
      'Find and verify:',
      '1. Exact Direct Application / Registration / Form URL (NOT generic homepage, get the direct apply/form page URL).',
      '2. Exact Official Fee (kitna paisa lagega category-wise in INR).',
      '3. Exact Eligibility & Documents required.',
      '4. Key steps and time required.',
    ]
      .filter(Boolean)
      .join('\n');

    let sources: GroundingSource[] = [...fallback.sources];
    let researchNotes = '';
    try {
      const res1 = await generateContentResilient(ai, {
        contents: researchPrompt,
        config: { tools: [{ googleSearch: {} }] },
      });
      const liveSources = extractGroundingSources(res1);
      if (liveSources.length > 0) sources = liveSources;
      researchNotes = res1.text?.trim() || '';
    } catch {
      return fallback;
    }

    const res2 = await generateContentResilient(ai, {
      contents: [
        `Create a clean Hinglish pre-flight brief for "${params.query}" BEFORE opening the direct form page.`,
        catalogItem ? `Verified Direct Form URL fallback: ${catalogItem.directFormUrl}` : '',
        `LIVE INTERNET RESEARCH:\n${researchNotes}`,
        'Return crisp Hinglish explanations: kitna paisa (feeSummary), kitna time (processingTime), eligibilitySummary, 3-4 keyHighlights, requiredDocuments (ONLY docs strictly needed for this task), 3 short formSteps, and the exact directFormUrl (never a generic homepage if a direct apply/form URL exists).',
      ]
        .filter(Boolean)
        .join('\n\n'),
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            portalName: { type: Type.STRING },
            directFormUrl: { type: Type.STRING },
            feeSummary: { type: Type.STRING },
            processingTime: { type: Type.STRING },
            eligibilitySummary: { type: Type.STRING },
            keyHighlights: { type: Type.ARRAY, items: { type: Type.STRING } },
            requiredDocuments: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING },
                  reason: { type: Type.STRING },
                },
                required: ['name', 'reason'],
              },
            },
            formSteps: { type: Type.ARRAY, items: { type: Type.STRING } },
            humanCheckNotes: { type: Type.STRING },
            directFormGoal: { type: Type.STRING },
          },
          required: [
            'title',
            'portalName',
            'directFormUrl',
            'feeSummary',
            'processingTime',
            'eligibilitySummary',
            'requiredDocuments',
            'formSteps',
            'directFormGoal',
          ],
        },
      },
    });

    const parsed = JSON.parse((res2.text ?? '{}').trim()) as Partial<ServiceBrief> & {
      requiredDocuments?: { name: string; reason: string }[];
    };

    const directUrl =
      parsed.directFormUrl && parsed.directFormUrl.startsWith('http')
        ? parsed.directFormUrl
        : fallback.directFormUrl;

    const reqDocs =
      Array.isArray(parsed.requiredDocuments) && parsed.requiredDocuments.length > 0
        ? parsed.requiredDocuments.map((d, i) => ({
            id: `${fallback.serviceId}-doc-${i + 1}`,
            name: String(d.name || 'Required Document'),
            reason: String(d.reason || 'Form auto-fill details ke liye'),
          }))
        : fallback.requiredDocuments;

    return {
      serviceId: fallback.serviceId,
      title: String(parsed.title || fallback.title),
      category: fallback.category,
      portalName: String(parsed.portalName || fallback.portalName),
      directFormUrl: catalogItem ? catalogItem.directFormUrl : directUrl,
      feeSummary: String(parsed.feeSummary || fallback.feeSummary),
      processingTime: String(parsed.processingTime || fallback.processingTime),
      eligibilitySummary: String(parsed.eligibilitySummary || fallback.eligibilitySummary),
      keyHighlights:
        Array.isArray(parsed.keyHighlights) && parsed.keyHighlights.length > 0
          ? parsed.keyHighlights.map(String)
          : fallback.keyHighlights,
      requiredDocuments: reqDocs,
      formSteps:
        Array.isArray(parsed.formSteps) && parsed.formSteps.length > 0
          ? parsed.formSteps.map(String)
          : fallback.formSteps,
      humanCheckNotes: String(parsed.humanCheckNotes || fallback.humanCheckNotes),
      directFormGoal: String(parsed.directFormGoal || fallback.directFormGoal),
      sources,
      fromLiveAi: true,
    };
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// AI Field Mapper (Narad AI "ai-autofill" idea, merged into SarthiAI)
// Rule-engine jo fields nahi pehchan paya, unko Gemini profile data se map karta hai.
// ---------------------------------------------------------------------------

export interface UnmatchedFormField {
  id: string;
  tag?: string;
  type?: string;
  name?: string;
  label?: string;
  placeholder?: string;
  options?: string[];
}

const NEVER_FILL_PATTERN =
  /captcha|security ?code|\botp\b|one[\s-]?time|\bcvv\b|\bcvc\b|card ?(no|number)|\bupi\b|\bvpa\b|net ?banking|\bifsc\b|account ?(no|number)/i;
const PASSWORD_FIELD_PATTERN = /pass ?word|passwd|\bpwd\b/i;

export async function mapFormFieldsWithAI(params: {
  fields: UnmatchedFormField[];
  data: Record<string, string>;
  pageTitle?: string;
  pageUrl?: string;
}): Promise<Record<string, string>> {
  const providedLoginPassword =
    typeof params.data?.loginPassword === 'string' && params.data.loginPassword.trim().length > 0
      ? params.data.loginPassword.trim().slice(0, 120)
      : '';

  const safeFields = params.fields
    .filter((f) => f && typeof f.id === 'string' && f.id.length > 0)
    .filter((f) => {
      const hint = `${f.label || ''} ${f.name || ''} ${f.placeholder || ''}`;
      if (NEVER_FILL_PATTERN.test(hint)) return false;
      if ((f.type === 'password' || PASSWORD_FIELD_PATTERN.test(hint)) && !providedLoginPassword) {
        return false;
      }
      return true;
    })
    .slice(0, 50)
    .map((f) => ({
      id: f.id,
      type: f.type || f.tag || 'text',
      label: (f.label || '').slice(0, 120),
      name: (f.name || '').slice(0, 60),
      placeholder: (f.placeholder || '').slice(0, 80),
      options: Array.isArray(f.options) ? f.options.slice(0, 40) : [],
    }));

  if (safeFields.length === 0) return {};

  // Sirf wahi data bhejo jo user ke payload me hai (zero-save me vault khali hota hai)
  const cleanData: Record<string, string> = {};
  for (const [k, v] of Object.entries(params.data || {})) {
    if (k === 'goal') continue;
    if (typeof v === 'string' && v.trim()) cleanData[k] = v.trim().slice(0, 300);
  }
  const hasSelectWithOptions = safeFields.some((f) => Array.isArray(f.options) && f.options.length > 0);
  if (Object.keys(cleanData).length === 0 && !hasSelectWithOptions) return {};
  const userGoal = String((params.data || {}).goal || '').slice(0, 300);

  const ai = getGeminiClient();
  const response = await generateContentResilient(ai, {
    contents: {
      parts: [
        {
          text: [
            'You are a careful Indian government, recruitment, and travel booking form-filling assistant.',
            `Page: ${params.pageTitle || 'unknown'} (${params.pageUrl || 'unknown url'})`,
            '',
            'USER DATA (the only source of truth, JSON):',
            JSON.stringify(cleanData),
            '',
            `USER GOAL: ${userGoal || 'not given (assume a new application by an individual)'}`,
            '',
            'FORM FIELDS that the rule-engine could not identify (JSON):',
            JSON.stringify(safeFields),
            '',
            'TASK: For each field, decide the value to enter using ONLY the user data above.',
            'RULES:',
            '- NEVER invent, guess or estimate values. If the user data does not contain the answer, OMIT that field.',
            '- For <select> or custom dropdown fields (options given, or Gender/Education Board/Category/Class/Quota/State): return the exact option label that best matches.',
            '- EXCEPTION to the omit rule: for dropdowns choosing Application Type / Individual vs Trust / Nationality / Country, use USER GOAL or standard individual defaults ("Indian", "India", "Individual", "New"). Never pick "Select" placeholders.',
            '- Handle SSC OTR "Verify ..." duplicate fields (Verify Gender, Verify Board, Verify Father Name, Verify Aadhaar) with the exact same value as the main field.',
            '- Handle IRCTC/ticket fields: From Station (`fromStation`), To Station (`toStation`), Journey Date (`journeyDate`), Class (`trainClass`), Quota (`trainQuota`), Berth (`berthPreference`).',
            '- Password field: Fill ONLY if `loginPassword` is explicitly present in USER DATA and the field is a login/sign-in password.',
            '- Dates: return YYYY-MM-DD for native date inputs or DD/MM/YYYY when text/label asks DD-MM-YYYY or DD/MM/YYYY.',
            '- Do NOT answer CAPTCHA, OTP, CVV, bank, card, UPI, or final declaration/consent fields.',
            '- Labels may be Hindi / Hinglish / English.',
            'Return JSON: an array "mappings" of { id, value }.',
          ].join('\n'),
        },
      ],
    },
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          mappings: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                value: { type: Type.STRING },
              },
              required: ['id', 'value'],
            },
          },
        },
        required: ['mappings'],
      },
    },
  });

  const parsed = JSON.parse((response.text ?? '{}').trim()) as {
    mappings?: Array<{ id?: string; value?: string }>;
  };

  const allowedIds = new Set(safeFields.map((f) => f.id));
  const fieldById = new Map(safeFields.map((f) => [f.id, f] as const));
  const clean = (t: string) => t.toLowerCase().replace(/[^a-z0-9\u0900-\u097f]+/g, ' ').trim();
  const nonSecretValues = Object.entries(cleanData)
    .filter(([k]) => k !== 'loginPassword')
    .map(([, v]) => v);
  const dataText = clean(nonSecretValues.join(' '));
  const dataDigits = nonSecretValues.join(' ').replace(/\D/g, '');
  const out: Record<string, string> = {};
  for (const m of parsed.mappings || []) {
    const id = String(m.id || '');
    const value = String(m.value || '').trim();
    if (!id || !value || !allowedIds.has(id)) continue;

    const f = fieldById.get(id);
    const hint = `${f?.label || ''} ${f?.name || ''} ${f?.placeholder || ''}`;
    if (f?.type === 'password' || PASSWORD_FIELD_PATTERN.test(hint)) {
      if (providedLoginPassword && value === providedLoginPassword) {
        out[id] = value;
      }
      continue;
    }

    // Text fields: value user ke data me hona chahiye (jaise "ENGLISH" ka mother's surname me jaana band)
    const isChoice = !!(f && Array.isArray(f.options) && f.options.length > 0);
    if (!isChoice) {
      const v = clean(value);
      const digits = value.replace(/\D/g, '');
      const isDate = /^\d{4}-\d{2}-\d{2}$/.test(value) || /^\d{2}[/-]\d{2}[/-]\d{4}$/.test(value);
      const grounded =
        (v.length > 0 && dataText.includes(v)) ||
        (digits.length >= 4 && dataDigits.includes(digits)) ||
        (isDate && digits.length >= 4 && dataDigits.includes(digits.slice(-4))) ||
        /^(indian|india)$/i.test(value);
      if (!grounded) continue;
    }
    out[id] = value;
  }
  return out;
}





// ---------------------------------------------------------------------------
// AI PAGE READER + FORM RECIPE (native APK portal ke liye)
// ---------------------------------------------------------------------------
export interface PageSnapshot {
  url?: string;
  title?: string;
  headings?: unknown[];
  fields?: Array<{
    id?: string;
    tag?: string;
    type?: string;
    label?: string;
    value?: string;
    required?: boolean;
    section?: string;
    options?: string[];
  }>;
  buttons?: Array<{ id?: string; text?: string }>;
}

function isBlockedPlanButton(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (/submit\s*(?:&|and)?\s*(?:next|continue|proceed)/i.test(t)) return false;
  return /submit|pay|payment|final|confirm|logout|sign ?out|cancel|back|previous|reset|clear|close|download|print|delete|remove|draft|verify|send otp|get otp|generate|upload|choose file|esign|e ?sign|digilocker|captcha|not a robot|recaptcha/i.test(
    t
  );
}

// Page ko padhkar: kaun se field me kya bharna hai + agla step kaunsa button hai
export async function planPageWithAI(params: {
  snapshot: PageSnapshot;
  data: Record<string, string>;
}): Promise<{ fills: Record<string, string>; click: string }> {
  const snap = params.snapshot || {};
  const providedLoginPassword =
    typeof params.data?.loginPassword === 'string' && params.data.loginPassword.trim().length > 0
      ? params.data.loginPassword.trim().slice(0, 120)
      : '';

  const fields = (Array.isArray(snap.fields) ? snap.fields : [])
    .filter((f) => f && typeof f.id === 'string' && f.id)
    .filter((f) => {
      const hint = `${f.label || ''} ${f.section || ''}`;
      if (NEVER_FILL_PATTERN.test(hint)) return false;
      if ((f.type === 'password' || PASSWORD_FIELD_PATTERN.test(hint)) && !providedLoginPassword) {
        return false;
      }
      return true;
    })
    .slice(0, 90)
    .map((f) => ({
      id: f.id as string,
      type: f.type || f.tag || 'text',
      label: String(f.label || '').slice(0, 120),
      section: String(f.section || '').slice(0, 60),
      value: String(f.value || '').slice(0, 60),
      required: !!f.required,
      options: Array.isArray(f.options) ? f.options.slice(0, 40) : [],
    }));
  const buttons = (Array.isArray(snap.buttons) ? snap.buttons : [])
    .filter((b) => b && typeof b.id === 'string' && b.id && typeof b.text === 'string' && b.text)
    .slice(0, 35)
    .map((b) => ({ id: b.id as string, text: String(b.text).slice(0, 40) }));

  if (fields.length === 0 && buttons.length === 0) return { fills: {}, click: '' };

  const cleanData: Record<string, string> = {};
  for (const [k, v] of Object.entries(params.data || {})) {
    if (typeof v === 'string' && v.trim()) cleanData[k] = v.trim().slice(0, 300);
  }
  const userGoal = String((params.data || {}).goal || '').slice(0, 300);

  const ai = getGeminiClient();
  const response = await generateContentResilient(ai, {
    contents: {
      parts: [
        {
          text: [
            'You are an expert Indian 3-to-10 page form & ticket assistant that reads a web page snapshot and decides every field to fill + the next step button.',
            `Page: ${snap.title || 'unknown'} (${snap.url || 'unknown url'})`,
            `Headings: ${JSON.stringify((snap.headings || []).slice(0, 12))}`,
            '',
            'USER DATA (the only source of truth, JSON):',
            JSON.stringify(cleanData),
            `USER GOAL: ${userGoal || 'not given (assume a new application by an individual)'}`,
            '',
            'PAGE FIELDS (JSON; "value" is what is already in the field; options may appear on <select> or custom dropdowns):',
            JSON.stringify(fields),
            '',
            'PAGE BUTTONS (JSON):',
            JSON.stringify(buttons),
            '',
            'TASK: 1) Identify the current stage/page of this multi-page form or booking flow. 2) For every EMPTY field (including custom dropdowns showing "Select" or empty comboboxes, Gender/Verify Gender, 10th Board/Verify Board, Category, IRCTC From/To/Date/Class/Quota) that USER DATA can answer, return the value. 3) If all required fields on this page are (or will be) filled and no CAPTCHA/OTP blocks the screen, return the id of the ONE step progression button ("Next", "Continue", "Save & Next", "Submit & Next", "Proceed", "Search Trains", "Book Now", or "Login"/"Sign In" ONLY when loginUserId+loginPassword are provided & filled). Otherwise return empty click "".',
            'RULES:',
            '- NEVER invent or guess names, dates, numbers, mobile, email, marks, stations, credentials, or addresses. If USER DATA does not contain the answer, OMIT the field.',
            '- Do not overwrite a field that already has a valid value (exception: placeholder text like "Select" or "Choose" counts as empty and MUST be filled).',
            '- For fields with options (or custom dropdowns), return the exact matching option label.',
            '- Low-risk defaults allowed: nationality=Indian, country=India, same-as-above style choices.',
            '- Dates: return DD/MM/YYYY unless the field type is date (YYYY-MM-DD) or label says DD-MM-YYYY.',
            '- Password field: fill ONLY if `loginPassword` exists in USER DATA.',
            '- NEVER fill CAPTCHA, OTP, bank/card/UPI, or declaration fields.',
            '- NEVER click Final Submit / Pay Now / Confirm Booking / Verify / Send OTP / Upload / Back / Cancel / Reset / Save Draft / "I am not a robot".',
            '- Labels may be Hindi / Hinglish / English.',
            'Return JSON: { "fills": [ { "id", "value" } ], "click": "<button id or empty>" }.',
          ].join('\n'),
        },
      ],
    },
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          fills: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: { id: { type: Type.STRING }, value: { type: Type.STRING } },
              required: ['id', 'value'],
            },
          },
          click: { type: Type.STRING },
        },
        required: ['fills'],
      },
    },
  });

  const parsed = JSON.parse((response.text ?? '{}').trim()) as {
    fills?: Array<{ id?: string; value?: string }>;
    click?: string;
  };

  const fieldById = new Map(fields.map((f) => [f.id, f] as const));
  const clean = (t: string) => t.toLowerCase().replace(/[^a-z0-9\u0900-\u097f]+/g, ' ').trim();
  const nonSecretValues = Object.entries(cleanData)
    .filter(([k]) => k !== 'loginPassword')
    .map(([, v]) => v);
  const dataText = clean(nonSecretValues.join(' '));
  const dataDigits = nonSecretValues.join(' ').replace(/\D/g, '');
  const outFills: Record<string, string> = {};
  for (const m of parsed.fills || []) {
    const id = String(m.id || '');
    const value = String(m.value || '').trim();
    const f = fieldById.get(id);
    if (!id || !value || !f) continue;
    const existing = f.value ? f.value.trim() : '';
    const isPlaceholderSelect = /^(select|please select|choose|--\s*select\s*--)$/i.test(existing);
    if (existing && !isPlaceholderSelect) continue; // pehle se bhara hai

    const hint = `${f.label || ''} ${f.section || ''}`;
    if (f.type === 'password' || PASSWORD_FIELD_PATTERN.test(hint)) {
      if (providedLoginPassword && value === providedLoginPassword) {
        outFills[id] = value;
      }
      continue;
    }

    const isChoice = f.options.length > 0 || /select|combobox|listbox|radio|checkbox/.test(f.type);
    if (!isChoice) {
      const v = clean(value);
      const digits = value.replace(/\D/g, '');
      const isDate = /^\d{4}-\d{2}-\d{2}$/.test(value) || /^\d{2}[/-]\d{2}[/-]\d{4}$/.test(value);
      const grounded =
        (v.length > 0 && dataText.includes(v)) ||
        (digits.length >= 4 && dataDigits.includes(digits)) ||
        (isDate && digits.length >= 4 && dataDigits.includes(digits.slice(-4))) ||
        /^(indian|india)$/i.test(value);
      if (!grounded) continue;
    }
    outFills[id] = value;
  }

  let click = String(parsed.click || '').trim();
  const btn = buttons.find((b) => b.id === click);
  if (!btn || isBlockedPlanButton(btn.text)) click = '';

  return { fills: outFills, click };
}

const RECIPE_KEYS = [
  'fullName', 'dob', 'gender', 'fatherName', 'motherName', 'mobile', 'alternateMobile', 'email',
  'aadhaarNumber', 'panNumber',
  'addressLine', 'villageOrWard', 'postOffice', 'policeStation', 'blockOrTehsil', 'district', 'state',
  'pinCode', 'birthPlace', 'category', 'maritalStatus', 'qualification', 'bloodGroup',
  'tenthBoard', 'tenthRoll', 'tenthYear', 'tenthPercent',
  'twelfthBoard', 'twelfthRoll', 'twelfthYear', 'twelfthPercent',
  'fromStation', 'toStation', 'journeyDate', 'trainClass', 'trainQuota', 'berthPreference',
  'loginUserId', 'loginPassword', 'incomeSource',
];

// "Sabji banane se pehle saman": is form ko poora karne me kaun si details aur documents lagenge
export async function formRecipeWithAI(params: {
  url?: string;
  title?: string;
  goal?: string;
}): Promise<{
  name: string;
  details: Array<{ key: string; label: string; options?: string[] }>;
  documents: Array<{ label: string }>;
}> {
  const ai = getGeminiClient();
  const response = await generateContentResilient(ai, {
    contents: {
      parts: [
        {
          text: [
            'You know Indian government, recruitment, and travel/ticket online applications (SSC OTR, UPSC, Army, Railway/RRB, PAN, driving licence, passport, voter ID, IRCTC train ticket booking, scholarships, certificates).',
            `The user is about to open this page: ${params.title || 'unknown'} (${params.url || 'unknown url'}).`,
            `USER GOAL: ${String(params.goal || '').slice(0, 300) || 'not given'}`,
            '',
            'TASK: Tell what the user must provide BEFORE the website opens so the AI can auto-fill ALL 3 to 10 pages without stopping or missing anything.',
            `1) "details": fields that will be filled across all pages of the portal. Use ONLY keys from this list: ${RECIPE_KEYS.join(', ')}. For gender/category/maritalStatus/trainClass/trainQuota/berthPreference add "options". Give a short Hinglish "label".`,
            '2) "documents": documents/photos/IDs the user may need to upload or scan (short Hinglish labels).',
            '3) "name": short name of the application/service.',
            'IMPORTANT MULTI-PAGE COMPLETENESS:',
            '- For exam/job/OTR forms (SSC, UPSC, Army, RRB, Police): include Personal Details (fullName, dob, gender, fatherName, motherName, aadhaarNumber, category, mobile, email), Address (addressLine, state, district, pinCode), AND 10th/12th Education (tenthBoard, tenthRoll, tenthYear, tenthPercent).',
            '- For IRCTC / Train Ticket booking: include fromStation, toStation, journeyDate, trainClass, trainQuota, berthPreference, passenger details (fullName, dob, gender, mobile, email), and optional loginUserId + loginPassword so AI can log in before OTP/payment.',
            '- Include loginUserId + loginPassword ONLY when the portal/goal requires user account login (e.g. IRCTC booking, SSC Login, DigiLocker/candidate login).',
            'RULES: NEVER include OTP, CAPTCHA, CVV, card number, UPI PIN, or payment items. If the page is just a general news/search page with no form/booking, return empty lists.',
            'Return JSON.',
          ].join('\n'),
        },
      ],
    },
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          details: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                key: { type: Type.STRING },
                label: { type: Type.STRING },
                options: { type: Type.ARRAY, items: { type: Type.STRING } },
              },
              required: ['key', 'label'],
            },
          },
          documents: {
            type: Type.ARRAY,
            items: { type: Type.OBJECT, properties: { label: { type: Type.STRING } }, required: ['label'] },
          },
        },
        required: ['name', 'details', 'documents'],
      },
    },
  });

  const parsed = JSON.parse((response.text ?? '{}').trim()) as {
    name?: string;
    details?: Array<{ key?: string; label?: string; options?: string[] }>;
    documents?: Array<{ label?: string }>;
  };
  const allowed = new Set(RECIPE_KEYS);
  const seen = new Set<string>();
  const details: Array<{ key: string; label: string; options?: string[] }> = [];
  for (const d of parsed.details || []) {
    const key = String(d.key || '');
    if (!allowed.has(key) || seen.has(key)) continue;
    seen.add(key);
    details.push({
      key,
      label: String(d.label || key).slice(0, 80),
      options: Array.isArray(d.options) ? d.options.slice(0, 12).map((o) => String(o).slice(0, 40)) : undefined,
    });
  }
  const documents = (parsed.documents || [])
    .map((d) => ({ label: String(d.label || '').slice(0, 80) }))
    .filter((d) => d.label)
    .slice(0, 12);
  return { name: String(parsed.name || '').slice(0, 60), details: details.slice(0, 22), documents };
}
