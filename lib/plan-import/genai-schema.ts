import { Type, type Schema } from "@google/genai";

// The genai response contract Gemini fills — mirrors ProjectPlanSchema in
// ./types.ts. Kept in its own module (imports the @google/genai runtime `Type`
// enum) so ./types.ts stays client-safe; only the server-side extractor imports
// this.
export const PROJECT_PLAN_GENAI_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    workspaceName: { type: Type.STRING },
    parentBoardTitle: { type: Type.STRING },
    workPackages: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          code: { type: Type.STRING },
          title: { type: Type.STRING },
          option: { type: Type.STRING, enum: ["RI", "SS", "RI+SS"] },
          start: { type: Type.STRING },
          end: { type: Type.STRING },
          description: { type: Type.STRING },
          lead: { type: Type.STRING },
          tasks: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                description: { type: Type.STRING },
              },
              required: ["title", "description"],
            },
          },
          deliverables: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                taskIndex: { type: Type.INTEGER },
                due: { type: Type.STRING },
                month: { type: Type.INTEGER },
                description: { type: Type.STRING },
              },
              required: ["title", "taskIndex", "due", "month", "description"],
            },
          },
        },
        required: ["code", "title", "option", "start", "end", "description", "tasks", "deliverables"],
      },
    },
    milestones: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          date: { type: Type.STRING },
          description: { type: Type.STRING },
        },
        required: ["name", "date", "description"],
      },
    },
  },
  required: ["workspaceName", "parentBoardTitle", "workPackages", "milestones"],
};
