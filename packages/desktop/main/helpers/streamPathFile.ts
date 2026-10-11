import { app } from 'electron'
import fs from 'fs'
import os from 'os'
import path from 'path'

let logFile: string | null = null

export function streamPathLogFile(): string {
    if (logFile !== null) {
        return logFile
    }

    if (app.isPackaged) {
        logFile = path.join(packagedLogDir(), 'stream-path.log')
        return logFile
    }

    const cwd = process.cwd()
    const desktopDir = cwd.endsWith(`${path.sep}desktop`) ? cwd : path.join(cwd, 'packages', 'desktop')
    logFile = path.join(desktopDir, 'stream-path.log')
    return logFile
}

function packagedLogDir(): string {
    try {
        return app.getPath('logs')
    } catch {
        return path.join(os.homedir(), 'Library', 'Logs', 'Greenlight')
    }
}

export function appendAuthLog(message: string) {
    try {
        const file = path.join(path.dirname(streamPathLogFile()), 'auth.log')
        fs.mkdirSync(path.dirname(file), { recursive: true })
        fs.appendFileSync(file, `${new Date().toISOString()} ${message}\n`)
    } catch {
        // Auth logging must not stop sign-in.
    }
}

export function appendStreamPathLog(message: string) {
    try {
        const file = streamPathLogFile()
        fs.mkdirSync(path.dirname(file), { recursive: true })
        fs.appendFileSync(file, `${new Date().toISOString()} ${message}\n`)
    } catch {
        // A missing log file must not stop the app from starting.
    }
}
