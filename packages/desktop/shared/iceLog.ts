export type IceAddressScope = 'lan' | 'mdns' | 'teredo' | 'public' | 'unknown'

export function describeIceCandidate(candidateLine: string): string {
    const line = (candidateLine || '').replace(/^a=/, '')
    const parts = line.trim().split(/\s+/)
    const foundation = parts[0] || ''
    if (!foundation.startsWith('candidate:')) {
        return line || '(empty)'
    }

    const protocol = (parts[2] || '?').toLowerCase()
    const address = parts[4] || '?'
    const port = parts[5] || '?'
    const typeIndex = parts.indexOf('typ')
    const type = typeIndex >= 0 ? parts[typeIndex + 1] : '?'
    const raddrIndex = parts.indexOf('raddr')
    const related = raddrIndex >= 0 ? parts[raddrIndex + 1] : ''
    const scope = addressScope(address)

    return [
        type,
        scope,
        protocol,
        `${address}:${port}`,
        related ? `via ${related}` : '',
    ].filter(Boolean).join(' ')
}

export function addressScope(address: string): IceAddressScope {
    const value = (address || '').toLowerCase().replace(/^\[|\]$/g, '')
    if (!value || value === '?') {
        return 'unknown'
    }
    if (value.endsWith('.local')) {
        return 'mdns'
    }
    if (value.startsWith('2001:0:') || value.startsWith('2001:0000:')) {
        return 'teredo'
    }
    if (isPrivateIpv4(value) || value.startsWith('fe80:') || value.startsWith('fc') || value.startsWith('fd')) {
        return 'lan'
    }
    if (value.includes(':') || /^\d+\.\d+\.\d+\.\d+$/.test(value)) {
        return 'public'
    }
    return 'unknown'
}

export function pathVerdict(localType: string, localAddress: string, remoteType: string, remoteAddress: string): string {
    if (localType === 'relay' || remoteType === 'relay') {
        return 'RELAY public path, not a direct LAN connection'
    }

    const localScope = addressScope(localAddress)
    const remoteScope = addressScope(remoteAddress)
    if (localScope === 'mdns' || remoteScope === 'mdns') {
        return 'MDNS hidden local name; the Xbox often cannot use this'
    }
    if (localScope === 'lan' && (remoteScope === 'lan' || remoteType === 'host')) {
        return 'LAN direct'
    }
    if (localScope === 'public' || remoteScope === 'public' || remoteScope === 'teredo') {
        return 'PUBLIC internet path'
    }
    return `OTHER local=${localScope} remote=${remoteScope}`
}

function isPrivateIpv4(address: string): boolean {
    const match = address.match(/^(\d+)\.(\d+)\.(\d+)\.\d+$/)
    if (!match) {
        return false
    }
    const first = Number(match[1])
    const second = Number(match[2])
    if (first === 10 || first === 127) {
        return true
    }
    if (first === 192 && second === 168) {
        return true
    }
    if (first === 172 && second >= 16 && second <= 31) {
        return true
    }
    if (first === 169 && second === 254) {
        return true
    }
    return false
}
