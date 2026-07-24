/**
 * Strips control characters from text for safe terminal output.
 */
export function sanitizeText(text: string): string {
    // eslint-disable-next-line no-control-regex
    return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
}