import Application from '../application'
import { withXboxTokenRetry } from './xboxAuth'

export default class xboxWorker {

    _application:Application
    
    _friends = {}
    _onlineFriends = {}

    constructor(application){
        this._application = application

        setInterval(() => {
            this.intervalFriends() 
        }, 30 * 1000) // Api is limited to 30 requests per 300 seconds. (300/30 = 10 sec)
        
        this.intervalFriends()
    }

    intervalFriends(){
        // console.log('xbox worker loop run')

        this.updateFriends().then((friends:any) => {
            // Get all friends
            // console.log('xboxWorker - Updated friends successfully')

            // Send over online friends
            const onlineFriends = []
            for(const friend in friends){
                if(friends[friend].presenceState !== 'Offline'){
                    onlineFriends.push(friends[friend])
                }
            }

            this._onlineFriends = onlineFriends
        }).catch((error) => {
            console.log('xboxWorker - Error updating friends:', error)
        })

    }

    updateFriends(){
        return withXboxTokenRetry(this._application, () => {
            return this._application._webApi.providers.people.getFriends()
        }).then((friends) => {
            for(const friend in friends.data.people){
                this._friends[friends.data.people[friend].xuid] = friends.data.people[friend]
            }

            return this._friends
        })
    }

}