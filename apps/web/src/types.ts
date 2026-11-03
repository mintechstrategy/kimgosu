export type PolicyKind = 'TERMS' | 'PRIVACY_CONSENT' | 'PRIVACY_POLICY' | 'MARKETING' | 'OPERATIONS';
export type Provider = 'kakao' | 'naver' | 'google';
export type NotificationKey = 'advertising' | 'chat' | 'comment' | 'quote' | 'inquiry';
export interface PolicyDocument { kind: PolicyKind; title: string; version: string; status: 'DRAFT' | 'READY' | 'RETIRED'; body: string; bodySha256: string; operator: string | null; effectiveAt: string | null; canConsent: boolean }
export interface AuthConfig { release: string; signupReady: boolean; providers: { id: Provider; enabled: boolean; reason?: string }[]; sms: { available: boolean; codeDigits: number; expiresInSeconds: number; phonePattern: string }; requiredFields: string[]; minimumAgeAcknowledgement: number; collectsGender: boolean; collectsAgeGroup: boolean; rejoinWaitDays: number; retention: { purpose: string; startsAt: string; calendarYears: number; rejoinResetsClock: boolean }; documents: Pick<PolicyDocument, 'kind' | 'version' | 'status' | 'canConsent'>[] }
export interface Member { id: string; customerNumber: string; name: string; email: string; nickname: string; status: 'ACTIVE' | 'RESTRICTED'; expertActive: boolean; createdAt: string }
export interface ConsentRecord { kind: PolicyKind; title: string; version: string; status: 'GRANTED' | 'WITHDRAWN'; recordedAt: string }
export type Preferences = Record<NotificationKey, boolean> & { version: number };
export type Screen = 'browse' | 'login' | 'signup' | 'info' | 'sms' | 'policies' | 'document' | 'member' | 'consents' | 'notifications' | 'withdraw' | 'expired' | 'restricted' | 'social-error';
