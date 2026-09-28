import { brine } from "../../src/worker"
import { interview } from "./interview"

const app = brine(interview)
export default app
// One Durable Object per respondent holds their walk; wrangler.jsonc binds it as BRINE_SESSIONS.
export const BrineSession = app.BrineSession
