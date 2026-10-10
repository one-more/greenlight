import type Application from '../application'

export function isExpiredXboxToken(error: unknown): boolean {
    const message = error instanceof Error ? error.message
        : typeof error === 'string' ? error
        : JSON.stringify(error ?? '')

    return message.includes('token_expired') || /"statuscode"\s*:\s*401/.test(message)
}

export function needsInteractiveSignIn(error: unknown): boolean {
    const name = (error as { name?: string } | null)?.name
    const message = error instanceof Error ? error.message : String(error ?? '')

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
