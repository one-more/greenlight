import IpcBase from './base'
import { withXboxTokenRetry } from '../helpers/xboxAuth'

export default class IpcConsoles extends IpcBase {
    // _streamingSessions:any = {}

    _consoles = []
    _consolesLastUpdate = 0

    get(){
        if(this._consolesLastUpdate >= Date.now() - 60*1000)
            return Promise.resolve(this._consoles)

        return withXboxTokenRetry(this._application, () => {
            return this._application._webApi.providers.smartglass.getConsolesList()
        }).then((consoles) => {
            this._consoles = consoles.data?.result || []
            this._consolesLastUpdate = Date.now()
            return this._consoles
        })
    }
}
