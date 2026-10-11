import { session, dialog } from 'electron'
import { createWindow } from './helpers'
import Application from './application'
import { Msal } from 'xal-node'
import AuthTokenStore from './helpers/tokenstore'
import { appendAuthLog } from './helpers/streamPathFile'
import { isRejectedRefresh, summarizeAuthError } from './helpers/xboxAuth'
import i18n from 'i18next';


export default class Authentication {
    _application:Application

    _tokenStore:AuthTokenStore
    _msal:Msal

    _authWindow
    _authCallback

    _isAuthenticating:boolean = false
    _isAuthenticated:boolean = false
    _appLevel:number = 0
    _authPromptOpen:boolean = false

    private t = i18n.t.bind(i18n);

    constructor(application:Application){
        this._application = application
        this._tokenStore = new AuthTokenStore(application._store)
        this._tokenStore.load()
        this._msal = new Msal(this._tokenStore)
    }

    checkAuthentication(){
        this._application.log('authenticationV2', '[checkAuthentication()] Starting token check...')
        if(this._tokenStore.hasValidAuthTokens()){

            // Deprecate xal token.
            if(this._tokenStore.getUserToken() !== undefined && this._tokenStore.getUserToken().data.scope != 'XboxLive.signin'){
                this._application.log('authenticationV2', '[checkAuthentication()] Deprecating old XAL token scope. Starting auth flow to get new tokens.')
                return false
            }

            this._application.log('authenticationV2', '[checkAuthentication()] Tokens are valid:', this._tokenStore.getUserToken())
            this.startSilentFlow()

            return true

        } else {
            if(this._tokenStore.getUserToken() !== undefined){
                // We have a user token, lets try to refresh it.
                this._application.log('authenticationV2', '[checkAuthentication()] Tokens are expired but we have a user token. Lets try to refresh the tokens.')
                this.startSilentFlow()

                return true

            } else {
                this._application.log('authenticationV2', '[checkAuthentication()] No tokens are present.')
                return false
            }
        }
    }

    startSilentFlow(){
        this._application.log('authenticationV2', '[startSilentFlow()] Starting silent flow...')
        this._isAuthenticating = true

        const forceRegionIp = this._application._store.get('force_region_ip', '')
        if (forceRegionIp && typeof forceRegionIp === 'string' && forceRegionIp.trim() !== '') {
            this._msal.setDefaultHeaders({ 'X-Forwarded-For': forceRegionIp.trim() })
            this._application.log('authenticationV2', '[startSilentFlow()] Using X-Forwarded-For:', forceRegionIp)
        } else {
            this._msal.setDefaultHeaders({})
        }

        this.restoreSession()
    }

    // An expired one-hour access token is normal after a restart. Renew the
    // saved sign-in and continue. Ask the user to sign in again only when
    // Microsoft rejects the refresh token.
    restoreSession(){
        this.openSession().catch((error) => {
            this.noteAuthFailure('saved session', error)
            if(isRejectedRefresh(error)){
                this._isAuthenticating = false
                this.startAuthflow()
                return
            }

            this.clearXboxSessionCache()
            this._msal.refreshUserToken().then(() => {
                return this.openSession()
            }).catch((retryError) => {
                this.noteAuthFailure('saved session retry', retryError)
                this._isAuthenticating = false
                if(isRejectedRefresh(retryError))
                    this.startAuthflow()
            })
        })
    }

    openSession(){
        return this.ensureFreshUserToken().then(() => {
            return this.getStreamingToken()
        }).then((streamingTokens) => {
            this._application.log('authenticationV2', '[openSession()] Retrieved streaming tokens')

            if(streamingTokens.xCloudToken !== undefined){
                this._application.log('authenticationV2', '[openSession()] Retrieved both xHome and xCloud tokens')
                this._appLevel = 2
            } else {
                this._application.log('authenticationV2', '[openSession()] Retrieved xHome token only')
                this._appLevel = 1
            }

            return this._msal.getWebToken().then((webToken) => {
                this._application.log('authenticationV2', '[openSession()] Web token received')
                this._application.authenticationCompleted(streamingTokens, webToken)
            })
        })
    }

    ensureFreshUserToken(){
        const userToken = this._tokenStore.getUserToken()
        if(userToken === undefined || userToken.getSecondsValid() > 60)
            return Promise.resolve()

        this._application.log('authenticationV2', '[ensureFreshUserToken()] Access token expired. Refreshing the saved sign-in.')
        appendAuthLog('access token expired; refreshing saved sign-in')
        return this._msal.refreshUserToken().then(() => undefined)
    }

    getTokens(){
        this.openSession().catch((error) => {
            this.noteAuthFailure('sign-in', error)
            this._isAuthenticating = false
            if(isRejectedRefresh(error))
                this.startAuthflow()
        })
    }

    clearXboxSessionCache(){
        const msalCache = this._msal as unknown as { _xstsToken?: unknown, _gssvToken?: unknown }
        msalCache._xstsToken = undefined
        msalCache._gssvToken = undefined
    }

    noteAuthFailure(step: string, error: unknown){
        const summary = summarizeAuthError(error)
        this._application.log('authenticationV2', `[${step}] ${summary}`)
        appendAuthLog(`${step}: ${summary}`)
    }

    refreshSessionTokens(){
        this._application.log('authenticationV2', '[refreshSessionTokens()] Refreshing Xbox session tokens')
        this.clearXboxSessionCache()

        return this.getStreamingToken().then((streamingTokens) => {
            return this._msal.getWebToken().then((webToken) => {
                this._application.installSessionClients(streamingTokens, webToken)
                this._application.log('authenticationV2', '[refreshSessionTokens()] Xbox session tokens refreshed')
            })
        }).catch((error) => {
            this.noteAuthFailure('session refresh', error)
            if(isRejectedRefresh(error) && this._authPromptOpen === false)
                this.startAuthflow()
            throw error
        })
    }

    startAuthflow(){
        if(this._authPromptOpen === true){
            this._application.log('authenticationV2', '[startAuthflow()] Authentication is already in progress')
            return
        }

        this._authPromptOpen = true
        this._application.log('authenticationV2', '[startAuthflow()] Starting authentication flow')

        const forceRegionIp = this._application._store.get('force_region_ip', '')
        if (forceRegionIp && typeof forceRegionIp === 'string' && forceRegionIp.trim() !== '') {
            this._msal.setDefaultHeaders({ 'X-Forwarded-For': forceRegionIp.trim() })
            this._application.log('authenticationV2', '[startSilentFlow()] Using X-Forwarded-For:', forceRegionIp)
        } else {
            this._msal.setDefaultHeaders({})
        }

        this._msal.doDeviceCodeAuth().then((data) => {
            this._application.log('authenticationV2', '[startAuthflow()] Starting devicecode auth:', data)

            dialog.showMessageBox({
                message: data.message+' Click OK to continue after entering code.',
                type: 'info',
            })

            this._isAuthenticating = true

            this._msal.doPollForDeviceCodeAuth(data.device_code).then((token) => {
                this._application.log('authenticationV2', '[startAuthflow()] Devicecode authentication successful:', token)

                this.getTokens()

            }).catch((error) => {
                this._application.log('authenticationV2', '[startAuthflow()] Error during devicecode polling auth:', error)
                dialog.showErrorBox('Error', 'Failed to perform MSAL authentixation: ' + JSON.stringify(error))

                this._isAuthenticating = false
                this._authPromptOpen = false
            })

        }).catch((error) => {
            this._application.log('authenticationV2', '[startAuthflow()] Error during devicecode auth:', error)
            dialog.showErrorBox('Error', this.t('errors.errorAuthentificationUser') + ' ' + JSON.stringify(error))
            this._authPromptOpen = false
        })
    }

    openAuthWindow(url){
        const authWindow = createWindow('auth', {
            width: 500,
            height: 600,
            title: this.t('auth.windowTitle'),
        })

        authWindow.loadURL(url)
        this._authWindow = authWindow

        this._authWindow.on('close', () => {
            this._application.log('authenticationV2', '[openAuthWindow()] Closed auth window')
            // @TODO: What to do?
        })
    }

    async getStreamingToken(){
        const userToken = this._tokenStore.getUserToken()
        if(userToken === undefined)
            throw new Error( this.t('errors.sisuTokenIsMissing') )

        this._application.log('authenticationV2', '[getStreamingToken()] Found local token:', userToken)

        const streamingTokens = await this._msal.getStreamingTokens()
        this._application.log('authenticationV2', '[getStreamingToken()] Retrieved streaming tokens:', streamingTokens)

        return { xHomeToken: streamingTokens.xHomeToken, xCloudToken: streamingTokens.xCloudToken }
        // return { xHomeToken: streamingTokens.xHomeToken, xCloudToken: undefined }
    }


}
