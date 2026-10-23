const configurationErrorCodes = new Set(["SERVICE_CONFIGURATION", "GAMEHUB_CONFIGURATION_MISSING"]);
const userInputErrorCodes = new Set(["22023", "23505", "23514"]);

export function classifyError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  const code = String(error?.code || "").toUpperCase();
  const status = Number(error?.status || 0);

  if (
    configurationErrorCodes.has(code)
    || ["42703", "PGRST200", "PGRST204"].includes(code)
    || /invalid api key|server integration is not configured|not configured for this deployment|payments are not configured|livekit.*not configured|supabase.*not configured|missing (?:required )?(?:environment )?(?:variable|configuration|setting|api key)|required .*configuration|configured .* does not match/.test(message)
  ) return "configuration";
  if (["NotAllowedError", "NotFoundError", "NotReadableError", "OverconstrainedError", "SecurityError"].includes(error?.name)) return "device";
  if (error?.name === "TypeError" && /fetch|network|connection|load failed/.test(message)) return "connection";
  if (status >= 500 || status === 429 || /temporarily unavailable|service unavailable|provider.*unavailable/.test(message)) return "service";
  if (userInputErrorCodes.has(code) || status === 400 || status === 422) return "input";
  if (status === 401 || status === 403 || code === "42501") return "access";
  return "unknown";
}

export function describeError(error) {
  switch (classifyError(error)) {
    case "configuration":
      return {
        category: "SERVICE CONFIGURATION",
        title: "GameHub needs operator attention",
        message: "A required service setting or API key is missing or invalid. This is a GameHub deployment/configuration issue, not a problem with your account or device. Please try again later or contact support.",
      };
    case "connection":
      return {
        category: "CONNECTION",
        title: "Connection problem",
        message: "GameHub could not reach the service. Check your internet connection and try again.",
      };
    case "device":
      return {
        category: "DEVICE PERMISSION",
        title: "Check your device permissions",
        message: "Your browser or device could not provide the requested microphone or camera. Check site permissions, device availability and whether another app is using it, then try again.",
      };
    case "service":
      return {
        category: "SERVICE",
        title: "GameHub service temporarily unavailable",
        message: "A GameHub or provider service could not complete the request. This is not necessarily caused by anything you did. Please try again later.",
      };
    case "input":
      return {
        category: "INPUT",
        title: "Please check the submitted details",
        message: "Some information did not meet the request requirements. Review the fields and try again.",
      };
    case "access":
      return {
        category: "ACCOUNT ACCESS",
        title: "This action is not available",
        message: "Your current session or permissions do not allow this action. Sign in again or contact support if you think this is a mistake.",
      };
    default:
      return {
        category: "UNEXPECTED",
        title: "We couldn’t complete that request",
        message: "An unexpected error occurred. It may be a GameHub service issue rather than a mistake on your part. Please try again, or contact support if it continues.",
      };
  }
}
