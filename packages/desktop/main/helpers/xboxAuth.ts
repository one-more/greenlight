import type Application from '../application'

export function isExpiredXboxToken(error: unknown): boolean {
    const message = error instanceof Error ? error.message
        : typeof error === 'string' ? error
        : JSON.stringify(error ?? '')

    return message.includes('token_expired') || /"statuscode"\s*:\s*401/.test(message)
}

export function authErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error ?? '')
}

export function isRejectedRefresh(error: unknown): boolean {
    if (needsInteractiveSignIn(error))
        return true

    const message = authErrorMessage(error)
    if (/invalid_grant|interaction_required|AADSTS70008|AADSTS700082|AADSTS50173|AADSTS50076|AADSTS50078|AADSTS700084/.test(message))
        return true

    return message.includes('login.microsoftonline.com') && /"statuscode":\s*400/.test(message)
}

export function summarizeAuthError(error: unknown): string {
    return authErrorMessage(error)
        .replace(/"access_token"\s*:\s*"[^"]*"/g, '"access_token":"..."')
        .replace(/"refresh_token"\s*:\s*"[^"]*"/g, '"refresh_token":"..."')
        .replace(/"Token"\s*:\s*"[^"]*"/g, '"Token":"..."')
        .replace(/\s+/g, ' ')
        .slice(0, 500)
}

export function needsInteractiveSignIn(error: unknown): boolean {
    const name = (error as { name?: string } | null)?.name
    const message = authErrorMessage(error)

    return name === 'TokenRefreshError'
        || message.includes('No refresh token')
        || message.includes('authenticate first')
        || message.includes('Sisu token')
        || message.includes('sisu token')
}

export async function withXboxTokenRetry<T>(application: Application, request: () => Promise<T>): Promise<T> {
    try {
        return await request()
    } catch (error) {
        if (!isExpiredXboxToken(error))
            throw error

        application.log('authenticationV2', 'Xbox token expired. Refreshing session and retrying the request.')
        await application.refreshSessionTokens()
        return await request()
    }
}
