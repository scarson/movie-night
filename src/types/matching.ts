// ABOUTME: Matching engine response types and the JSON schema enforced via
// ABOUTME: Anthropic structured outputs (output_config.format).

export interface MemberTaste {
  userId: string;
  name: string;
  summary: string;
  primaryVibes: string[];
  genreAffinities: string[];
}

export interface OverlapZone {
  summary: string;
  sharedVibes: string[];
  tensionPoints: string[];
}

export interface TasteMap {
  members: MemberTaste[];
  overlap: OverlapZone;
}

export interface Recommendation {
  tmdbId: number;
  matchScore: number;
  explanation: string;
}

export interface MatchingResponse {
  tasteMap: TasteMap;
  recommendations: Recommendation[];
  conversational: string;
}

export const MATCHING_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    tasteMap: {
      type: "object",
      properties: {
        members: {
          type: "array",
          items: {
            type: "object",
            properties: {
              userId: { type: "string" },
              name: { type: "string" },
              summary: { type: "string" },
              primaryVibes: { type: "array", items: { type: "string" } },
              genreAffinities: { type: "array", items: { type: "string" } },
            },
            required: ["userId", "name", "summary", "primaryVibes", "genreAffinities"],
            additionalProperties: false,
          },
        },
        overlap: {
          type: "object",
          properties: {
            summary: { type: "string" },
            sharedVibes: { type: "array", items: { type: "string" } },
            tensionPoints: { type: "array", items: { type: "string" } },
          },
          required: ["summary", "sharedVibes", "tensionPoints"],
          additionalProperties: false,
        },
      },
      required: ["members", "overlap"],
      additionalProperties: false,
    },
    recommendations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          tmdbId: { type: "integer" },
          matchScore: { type: "integer" },
          explanation: { type: "string" },
        },
        required: ["tmdbId", "matchScore", "explanation"],
        additionalProperties: false,
      },
    },
    conversational: { type: "string" },
  },
  required: ["tasteMap", "recommendations", "conversational"],
  additionalProperties: false,
} as const;
