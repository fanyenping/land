import { polishPlan } from "../ai/polish";
import { PolishPlanRequestSchema } from "../ai/schemas";
import type { PolishPlanRequest } from "../../shared/types";
import { aiRoute } from "./aiRoute";

/** POST /api/polish-plan — 依護理師口述整理護理計畫的語句（只收口述文字，不收訪視事實、評估或現行計畫）。 */
export const polishPlanRoute = aiRoute(PolishPlanRequestSchema, (body, signal) => polishPlan(body satisfies PolishPlanRequest, signal));
