import { generateDoc } from "../ai/generate";
import { GenerateRequestSchema } from "../ai/schemas";
import type { GenerateRequest } from "../../shared/types";
import { aiRoute } from "./aiRoute";

/** POST /api/generate — 依已檢核的事實撰寫一份（護理紀錄／護理計畫／家屬衛教）。 */
export const generateRoute = aiRoute(GenerateRequestSchema, (body, signal) => generateDoc(body satisfies GenerateRequest, signal));
