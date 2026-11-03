// Supported v0.3 compatibility constants from frozen API contract SHA6985e013.
// Validation only; rendering/grant inputs consume the returned snapshot.
export const supportedPolicy = {
  "cache": {
    "control": "no-store",
    "ttlSeconds": 0,
    "revalidateBeforeConsent": true
  },
  "requirements": {
    "requiredGrantKinds": [
      "TERMS",
      "PRIVACY_CONSENT"
    ],
    "requiredReadyKindsForGrant": [
      "TERMS",
      "PRIVACY_CONSENT",
      "PRIVACY_POLICY"
    ],
    "optionalGrantKinds": [
      "MARKETING"
    ],
    "operationsConsentRequired": false
  },
  "constraints": {
    "consentInputs": {
      "type": "array",
      "minItems": 2,
      "maxItems": 3,
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "kind",
          "version"
        ],
        "properties": {
          "kind": {
            "type": "string",
            "enum": [
              "TERMS",
              "PRIVACY_CONSENT",
              "MARKETING"
            ]
          },
          "version": {
            "type": "string",
            "minLength": 1,
            "maxLength": 100
          }
        }
      }
    },
    "nickname": {
      "type": "string",
      "pattern": "^[\\p{L}\\p{N}]{1,10}$",
      "maxLength": 10
    }
  },
  "limitations": {
    "commitFence": false,
    "allowedActions": "NOT_IMPLEMENTED",
    "materialChangeClassification": "NOT_IMPLEMENTED"
  }
} as const;
