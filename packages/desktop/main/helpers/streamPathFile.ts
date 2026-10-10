import fs from 'fs'
import path from 'path'

let logFile: string | null = null

export function streamPathLogFile(): string {
    if (logFile !== null) {
        return logFile
    }

    const cwd = process.cwd()
    const desktopDir = cwd.endsWith(`${path.sep}desktop`) ? cwd : path.join(cwd, 'packages', 'desktop')
    logFile = path.join(desktopDir, 'stream-path.log')
    return logFile
}

export function appendStreamPathLog(message: string) {
    const file = streamPathLogFile()
    const line = `${new Date().toISOString()} ${message}\n`
    fs.appendFileSync(file, line)
}
