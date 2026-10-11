import { TokenStore } from 'xal-node'
import Store from 'electron-store'

export default class AuthTokenStore extends TokenStore {

    private _store: Store

    constructor(store?: Store) {
        super()
        this._store = store || new Store()
    }

    load() {
        const tokens = this._store.get('user.tokenstore', '{}') as string
        this.loadJson(tokens)

        return true
    }

    save() {
        const data = JSON.stringify({
            userToken: this._userToken?.data,
            sisuToken: this._sisuToken?.data,
            jwtKeys: this._jwtKeys,
        })

        this._store.set('user.tokenstore', data)
    }

    clear() {
        this._store.delete('user.tokenstore')
        this._userToken = undefined
        this._sisuToken = undefined
        this._jwtKeys = undefined
    }

    removeAll() {
        this._userToken = undefined
        this._sisuToken = undefined

        this._store.delete('user.tokenstore')
    }
}