import { SimpleAuth, getWebRequest } from "@mastra/core/server";

type AppUser = {
    id: string;
    name: string;
    role: "admin" | "member";
};

// Tokens loaded from env. The token value IS the user's password/secret.
const ADMIN_TOKEN = process.env.ADMIN_API_KEY;
const MEMBER_TOKEN = process.env.MEMBER_API_KEY;

const tokens: Record<string, AppUser> = {};

if (ADMIN_TOKEN) {
    tokens[ADMIN_TOKEN] = { id: "admin", name: "admin", role: "admin" };
}
if (MEMBER_TOKEN) {
    tokens[MEMBER_TOKEN] = { id: "member", name: "member", role: "member" };
}

if (Object.keys(tokens).length === 0) {
    console.warn(
        "[auth] No ADMIN_API_KEY or MEMBER_API_KEY set — Studio and the API are inaccessible until at least one token is configured.",
    );
}

export const auth = new SimpleAuth<AppUser>({
    tokens,
    // Non-EE authorization: SimpleAuth.authenticate establishes identity; this
    // callback enforces WHAT an identity may do. EE (StaticRBACProvider) would
    // additionally hide Studio UI actions per role, which is intentionally not
    // used here.
    authorizeUser: async (user, request) => {
        const url = getWebRequest(request)?.url ?? "";
        // Pause/resume schedules — admin only (mirrors schedules:write).
        if (/\/api\/schedules\/[^/]+\/(pause|resume)(?:\/|\?|#|$)/.test(url)) {
            return user.role === "admin";
        }
        return true;
    },
});
