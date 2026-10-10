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

    try {
        os.setPriority(process.pid, os.constants.priority.PRIORITY_HIGH)
        appendStreamPathLog(`process priority high (nice ${os.getPriority(process.pid)})`)
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        appendStreamPathLog(`process priority unchanged (${message})`)
    }

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
