import Application from '../application'
import xCloudApi, { playResult } from './xcloudapi'
import { acquireStreamPerformance, releaseStreamPerformance } from './streamPerformance'

interface streamSession {
    id: string;
    target: string;
    path: string;
    type: string|'home'|'cloud';
    state?: string;
    waitingTimes?: any;
    playerState: string|'pending'|'started'|'queued'|'failed';
    errorDetails?: {
        code;
        message;
    };
}

function sessionStatus(error: unknown): number | undefined {
    const status = (error as { status?: number })?.status
    return typeof status === 'number' ? status : undefined
}

function isFinishedSession(error: unknown): boolean {
    const status = sessionStatus(error)
    return status === 401 || status === 404 || status === 410
}

export default class StreamManager {

    _application:Application

    _sessions = {}
    
    constructor(application){
        this._application = application
    }

    getApi(type):xCloudApi{
        if(type === 'home'){
            return this._application._xHomeApi
        } else {
            return this._application._xCloudApi
        }
    }

    getSession(sessionId:string):streamSession {
        return this._sessions[sessionId]
    }

    startStream(type:string|'home'|'cloud', target){
        return new Promise((resolve, reject) => {
            this.getApi(type).startStream(target).then((playResult:playResult) => {
            // this._application._xCloudApi.startStream(type, target).then((playResult) => {
                console.log('Streammanager - startStream:', playResult)

                const sessionId = playResult.sessionPath.split('/')[3]

                const streamSession:streamSession = {
                    id: sessionId,
                    target: target,
                    path: playResult.sessionPath,
                    type: type,
                    playerState: 'pending',
                }
                this._sessions[sessionId] = streamSession
                this.monitorSession(sessionId)
                acquireStreamPerformance(this._application._mainWindow)

                resolve(sessionId)
            }).catch((error) => {
                reject(error)
            })
        })
    }

    async stopStream(sessionId){
        const session = this.getSession(sessionId)
        if(session === undefined){
            this._application.log('StreamManager', 'stopStream('+sessionId+') session is already gone')
            return false
        }

        try {
            const result = await this.getApi(session.type).stopStream(sessionId)
            this.dropSession(sessionId)
            return result
        } catch (error) {
            if(!isFinishedSession(error))
                throw error

            // A 401 here is usually an expired streaming token, not a failed disconnect.
            // Refresh once and tell the console to end the session again.
            if(sessionStatus(error) === 401){
                this._application.log('StreamManager', 'stopStream('+sessionId+') streaming token was not accepted. Refreshing and ending the session once more.')
                try {
                    await this._application.refreshSessionTokens()
                    const result = await this.getApi(session.type).stopStream(sessionId)
                    this.dropSession(sessionId)
                    return result
                } catch (retryError) {
                    if(!isFinishedSession(retryError)){
                        this._application.log('StreamManager', 'stopStream('+sessionId+') could not refresh the streaming token. Closing the local session.')
                    }
                }
            }

            this._application.log('StreamManager', 'stopStream('+sessionId+') session is already closed')
            this.dropSession(sessionId)
            return false
        }
    }

    dropSession(sessionId){
        delete this._sessions[sessionId]
        if(Object.keys(this._sessions).length === 0){
            releaseStreamPerformance(this._application._mainWindow)
        }
    }

    sendSdp(sessionId:string, sdp:any){
        return new Promise((resolve, reject) => {
            const session = this.getSession(sessionId)
            if(session === undefined){
                reject('Session not found: '+sessionId)
                return
            }

            this.getApi(session.type).sendSdp(sessionId, sdp).then((result) => {

                resolve(result)
            }).catch((error) => {
                reject(error)
            })
        })
    }

    sendChatSdp(sessionId:string, sdp:any){
        return new Promise((resolve, reject) => {
            const session = this.getSession(sessionId)
            if(session === undefined){
                reject('Session not found: '+sessionId)
                return
            }

            this.getApi(session.type).sendChatSdp(sessionId, sdp).then((result) => {

                resolve(result)
            }).catch((error) => {
                reject(error)
            })
        })
    }

    sendIce(sessionId:string, ice:any){
        return new Promise((resolve, reject) => {
            const session = this.getSession(sessionId)
            if(session === undefined){
                reject('Session not found: '+sessionId)
                return
            }

            this.getApi(session.type).sendIce(sessionId, ice).then((result) => {

                resolve(result)
            }).catch((error) => {
                reject(error)
            })
        })
    }

    sendKeepalive(sessionId:string){
        return new Promise((resolve, reject) => {
            const session = this.getSession(sessionId)
            if(session === undefined){
                reject('Session not found: '+sessionId)
                return
            }

            this.getApi(session.type).sendKeepalive(sessionId).then((result) => {
                resolve(result)
            }).catch((error) => {
                reject(error)
            })
        })
    }

    monitorSession(sessionId){
        setTimeout(() => {
            this._application.log('StreamManager', 'monitorSession('+sessionId+') checking state')

            const session = this.getSession(sessionId)
            if(session === undefined){
                this._application.log('StreamManager', 'monitorSession('+sessionId+') session not found')
                return
            }
            this.getApi(this.getSession(sessionId).type).getStreamState(sessionId).then((result:any) => {
                console.log('Streammanager - state:', result)

                this.getSession(sessionId).state = result.state

                if(result.state === 'Provisioned'){
                    this.getSession(sessionId).playerState = 'started'

                } else if(result.state === 'Provisioning'){
                    // Lets loop again
                    this.monitorSession(sessionId)

                } else if(result.state === 'ReadyToConnect'){
                    // Do MSAL Auth
                    // @TODO: Refresh token if expired?
                    this._application._authentication._msal.getMsalToken().then((msalToken) => {
                        this.getApi(this.getSession(sessionId).type).sendMSALAuth(sessionId, msalToken.data.lpt).then(() => {
                            this.monitorSession(sessionId)

                        }).catch((error) => {
                            console.log('MSAL AUTH Error:', error)
                            alert('MSAL AUTH Error:'+ error)
                        })
                    }).catch((error) => {
                        console.log('MSAL AUTH Error:', error)
                        alert('MSAL AUTH Error:'+ error)
                    })

                } else if(result.state === 'WaitingForResources'){
                    // Do Queue logic
                    if(this.getSession(sessionId).waitingTimes === undefined){
                        this.getApi(this.getSession(sessionId).type).getWaitingTimes(this.getSession(sessionId).target).then((waitingTimes) => {
                            this.getSession(sessionId).waitingTimes = waitingTimes
                            this.getSession(sessionId).playerState = 'queued'

                        })
                    }
                    
                    this.monitorSession(sessionId)

                } else if(result.state === 'Failed'){
                    this.getSession(sessionId).errorDetails = result.errorDetails
                    this.getSession(sessionId).playerState = 'failed'

                } else {
                    
                    console.log('Unknown state:', result)
                }

            }).catch((error) => {
                console.log('Streammanager - error checking state:', sessionId, error)

                if(error.status === 404){
                    this._application.log('StreamManager', 'Session not found on server. Removing session...')
                    this.dropSession(sessionId)
                } else {
                    this.monitorSession(sessionId)
                }
            })
        }, 1000)
    }

    getActiveSessions(){
        return new Promise((resolve, reject) => {
            this.getApi('cloud').getActiveSessions().then((result) => {

                console.log('Active sessions:', result)
                resolve(result)
            }).catch((error) => {
                reject(error)
            })
        })
    }
}