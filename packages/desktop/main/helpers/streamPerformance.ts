import { execFile } from 'child_process'
import { powerSaveBlocker, BrowserWindow } from 'electron'
import os from 'os'
import { appendStreamPathLog } from './streamPathFile'

let holders = 0
let suspensionBlocker = -1
let displayBlocker = -1
let fullscreenOwnedByStream = false

export function acquireStreamPerformance(window?: BrowserWindow) {
    holders++
    if(holders > 1){
        return
    }

    suspensionBlocker = powerSaveBlocker.start('prevent-app-suspension')
    displayBlocker = powerSaveBlocker.start('prevent-display-sleep')
    appendStreamPathLog('stream performance mode on: App Nap blocked, display stays awake')

    raiseProcessPriority(process.pid, 'main')
    raiseHelperPriorities()

    if(process.platform !== 'darwin' || window === undefined || window.isDestroyed()){
        return
    }

    if(window.isFullScreen()){
        appendStreamPathLog('already fullscreen, macOS Game Mode can stay active')
        return
    }

    fullscreenOwnedByStream = true
    window.setFullScreen(true)
    appendStreamPathLog('entered fullscreen so macOS Game Mode can take the controller and CPU')
}

export function releaseStreamPerformance(window?: BrowserWindow) {
    if(holders === 0){
        return
    }
    holders--
    if(holders > 0){
        return
    }

    if(powerSaveBlocker.isStarted(suspensionBlocker)){
        powerSaveBlocker.stop(suspensionBlocker)
    }
    if(powerSaveBlocker.isStarted(displayBlocker)){
        powerSaveBlocker.stop(displayBlocker)
    }
    suspensionBlocker = -1
    displayBlocker = -1

    if(fullscreenOwnedByStream && window !== undefined && !window.isDestroyed() && window.isFullScreen()){
        window.setFullScreen(false)
        appendStreamPathLog('left fullscreen')
    }
    fullscreenOwnedByStream = false
    appendStreamPathLog('stream performance mode off')
}

function raiseProcessPriority(pid: number, label: string) {
    const levels = [os.constants.priority.PRIORITY_HIGH, os.constants.priority.PRIORITY_ABOVE_NORMAL]
    for (const level of levels) {
        try {
            os.setPriority(pid, level)
            appendStreamPathLog(`${label} priority raised (nice ${os.getPriority(pid)})`)
            return
        } catch {
            // The next level is less aggressive and more likely to be allowed.
        }
    }
    appendStreamPathLog(`${label} priority unchanged`)
}

function raiseHelperPriorities() {
    execFile('ps', ['-axo', 'pid=,ppid='], (error, stdout) => {
        if (error) {
            appendStreamPathLog(`helper priority scan failed (${error.message})`)
            return
        }
        const edges = new Map<number, number[]>()
        for (const line of stdout.split('\n')) {
            const [pidText, parentText] = line.trim().split(/\s+/)
            const pid = Number(pidText)
            const parent = Number(parentText)
            if (!pid || !parent) {
                continue
            }
            const children = edges.get(parent) || []
            children.push(pid)
            edges.set(parent, children)
        }
        const pending = [...(edges.get(process.pid) || [])]
        const helpers: number[] = []
        while (pending.length > 0) {
            const pid = pending.pop()
            if (pid === undefined || helpers.includes(pid)) {
                continue
            }
            helpers.push(pid)
            pending.push(...(edges.get(pid) || []))
        }
        helpers.forEach((pid, index) => raiseProcessPriority(pid, `helper ${index + 1}`))
        if (helpers.length === 0) {
            appendStreamPathLog('no helper processes to prioritize')
        }
    })
}
