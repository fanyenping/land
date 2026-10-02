import { translateEdu } from "../ai/translate";
import { TranslateRequestSchema } from "../ai/schemas";
import type { TranslateRequest } from "../../shared/types";
import { aiRoute } from "./aiRoute";

/** POST /api/translate — 已確認的中文衛教 → 印尼文／越南文／泰文。 */
export const translateRoute = aiRoute(TranslateRequestSchema, (body, signal) => translateEdu(body satisfies TranslateRequest, signal));
