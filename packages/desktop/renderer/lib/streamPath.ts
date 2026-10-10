import { describeIceCandidate, pathVerdict } from '../../shared/iceLog'
import Ipc from './ipc'

function emit(line: string) {
    console.log(line)
    try {
        const pending = Ipc.send('streaming', 'logPath', { message: line })
        if(pending && typeof pending.catch === 'function'){
            pending.catch(() => {})
        }
    } catch {
        // The main process writes the file. Ignore a failed send during reload.
    }
}

export function logStreamPath(line: string) {
    emit(line.startsWith('[stream-path]') ? line : `[stream-path] ${line}`)
}

export function applyLowLatencyReceivers(peer: RTCPeerConnection, quiet = false) {
    let applied = 0
    peer.getReceivers().forEach((receiver) => {
        const kind = receiver.track?.kind
        if(kind !== 'video' && kind !== 'audio'){
            return
        }
        const rtp = receiver as RTCRtpReceiver & { playoutDelayHint?: number, jitterBufferTarget?: number }
        try {
            if(kind === 'video'){
                rtp.playoutDelayHint = 0
                rtp.jitterBufferTarget = 0
            } else {
                rtp.playoutDelayHint = 0.02
                rtp.jitterBufferTarget = 20
            }
            applied++
        } catch (error) {
            emit(`[stream-path] low-latency hint failed for ${kind}: ${error}`)
        }
    })
    if(!quiet && applied > 0){
        emit(`[stream-path] low-latency hints applied to ${applied} receivers`)
    }
}

export function logIceList(direction: 'local' | 'remote', candidates: Array<{ candidate?: string }>) {
    emit(`[stream-path] ${direction} candidates: ${candidates.length}`)
    candidates.forEach((item, index) => {
        emit(`[stream-path] ${direction} #${index + 1} ${describeIceCandidate(item?.candidate || '')}`)
    })
}

export function waitForLocalIce(peer: RTCPeerConnection, readCandidates: () => RTCIceCandidate[], timeoutMs = 4000): Promise<RTCIceCandidate[]> {
    return new Promise((resolve) => {
        const finish = (reason: string) => {
            const candidates = readCandidates()
            emit(`[stream-path] sending ${candidates.length} local candidates (${reason}, gathering=${peer.iceGatheringState})`)
            logIceList('local', candidates)
            resolve(candidates)
        }

        if (peer.iceGatheringState === 'complete') {
            finish('gathering already complete')
            return
        }

        const timer = setTimeout(() => finish('timed out waiting for gathering'), timeoutMs)
        const onState = () => {
            emit(`[stream-path] iceGatheringState=${peer.iceGatheringState}`)
            if (peer.iceGatheringState === 'complete') {
                clearTimeout(timer)
                peer.removeEventListener('icegatheringstatechange', onState)
                finish('gathering complete')
            }
        }
        peer.addEventListener('icegatheringstatechange', onState)
    })
}

export async function logSelectedIcePath(peer: RTCPeerConnection) {
    const stats = await peer.getStats()
    logPlaybackTiming(stats)
    let selectedPairId = ''

    stats.forEach((report) => {
        if (report.type === 'transport' && report.selectedCandidatePairId) {
            selectedPairId = report.selectedCandidatePairId
        }
    })

    const succeeded: string[] = []
    stats.forEach((report) => {
        if (report.type !== 'candidate-pair' || report.state !== 'succeeded') {
            return
        }
        const local = stats.get(report.localCandidateId)
        const remote = stats.get(report.remoteCandidateId)
        const summary = formatPair(local, remote, report)
        succeeded.push(summary)
        if (!selectedPairId && report.nominated) {
            selectedPairId = report.id
        }
    })

    emit(`[stream-path] succeeded pairs: ${succeeded.length || 0}`)
    succeeded.forEach((line) => emit(`[stream-path] pair ${line}`))

    const selected = selectedPairId ? stats.get(selectedPairId) : undefined
    if (!selected) {
        emit('[stream-path] VERDICT: no selected candidate pair yet')
        return
    }

    const local = stats.get(selected.localCandidateId)
    const remote = stats.get(selected.remoteCandidateId)
    const verdict = pathVerdict(
        local?.candidateType || '',
        candidateAddress(local),
        remote?.candidateType || '',
        candidateAddress(remote),
    )
    emit(`[stream-path] SELECTED ${formatPair(local, remote, selected)}`)
    emit(`[stream-path] VERDICT: ${verdict}`)
}

function logPlaybackTiming(stats: RTCStatsReport) {
    stats.forEach((report) => {
        if(report.type !== 'inbound-rtp'){
            return
        }
        const kind = report.kind || report.mediaType
        if(kind !== 'video' && kind !== 'audio'){
            return
        }
        const bufferMs = averageMs(report.jitterBufferDelay, report.jitterBufferEmittedCount)
        const decodeMs = kind === 'video' ? averageMs(report.totalDecodeTime, report.framesDecoded) : null
        const processingMs = kind === 'video' ? averageMs(report.totalProcessingDelay, report.framesDecoded) : null
        const jitterMs = typeof report.jitter === 'number' ? Math.round(report.jitter * 1000) : null
        const parts = [
            `[stream-path] ${kind} timing`,
            bufferMs !== null ? `jitterBuffer=${bufferMs}ms` : '',
            jitterMs !== null ? `jitter=${jitterMs}ms` : '',
            decodeMs !== null ? `decode=${decodeMs}ms` : '',
            processingMs !== null ? `processing=${processingMs}ms` : '',
            typeof report.framesDecoded === 'number' ? `decoded=${report.framesDecoded}` : '',
            typeof report.framesDropped === 'number' ? `dropped=${report.framesDropped}` : '',
            typeof report.freezeCount === 'number' ? `freezes=${report.freezeCount}` : '',
        ].filter(Boolean)
        emit(parts.join(' '))
    })
}

function averageMs(totalSeconds: number | undefined, count: number | undefined): number | null {
    if(typeof totalSeconds !== 'number' || typeof count !== 'number' || count <= 0){
        return null
    }
    return Math.round((totalSeconds / count) * 1000)
}

function formatPair(local, remote, pair): string {
    const rtt = typeof pair?.currentRoundTripTime === 'number' ? ` rtt=${Math.round(pair.currentRoundTripTime * 1000)}ms` : ''
    const bytes = typeof pair?.bytesReceived === 'number' ? ` in=${pair.bytesReceived}B` : ''
    return `${candidateLabel(local)} -> ${candidateLabel(remote)}${rtt}${bytes} nominated=${pair?.nominated === true}`
}

function candidateLabel(report): string {
    if (!report) {
        return '?'
    }
    const relay = report.relayProtocol ? `/${report.relayProtocol}` : ''
    return `${report.candidateType || '?'}${relay} ${candidateAddress(report)}:${report.port || '?'} ${report.protocol || '?'}`
}

function candidateAddress(report): string {
    return report?.address || report?.ip || '?'
}
