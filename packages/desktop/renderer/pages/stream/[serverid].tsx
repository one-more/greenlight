import React from 'react'
import Head from 'next/head'
import { useRouter } from 'next/router'
import xCloudPlayer from 'xbox-xcloud-player'

import { useSettings } from '../../context/userContext'
import StreamComponent from '../../components/ui/streamcomponent'
import StreamPreload from '../../components/ui/streampreload'
import Ipc from '../../lib/ipc'
import { installSelectedGamepad } from '../../lib/gamepadSelection'
import { applyLowLatencyReceivers, followConsolePicture, logIceList, logSelectedIcePath, logStreamPath, waitForLocalIce } from '../../lib/streamPath'
import { useTranslation } from 'react-i18next'

function Stream() {
    const router = useRouter()
    const { settings } = useSettings()
    const { t } = useTranslation()

    let streamStateInterval
    let keepaliveInterval
    let pathLogInterval

    const [xPlayer, setxPlayer] = React.useState(undefined)
    const [sessionId, setSessionId] = React.useState('')
    const [queueTime, setQueueTime] = React.useState(0)

    React.useEffect(() => {
        // Detect stream type and title / server id
        let streamType = 'home'
        let serverId = router.query.serverid
        if((router.query.serverid as string).substr(0, 6) === 'xcloud'){
            streamType = 'cloud'
            serverId = (router.query.serverid as string).substr(7)
        }

        let restoreGamepad = () => {}
        let stopFollowingPicture = () => {}

        if(xPlayer !== undefined){
            stopFollowingPicture = followConsolePicture(xPlayer)
            restoreGamepad = installSelectedGamepad(settings.input_gamepad_id || '')
            document.getElementById('streamComponentHolder').innerHTML = '<div id="streamComponent" class="size_'+settings.video_size+'"></div>'
            xPlayer.bind()

            // Set bitrates & video codec profiles
            if((streamType === 'cloud') ? settings.xcloud_bitrate : settings.xhome_bitrate > 0){
                xPlayer.setVideoBitrate((streamType === 'cloud') ? settings.xcloud_bitrate : settings.xhome_bitrate)
            }

            if(settings.video_profiles.length > 0){
                xPlayer.setCodecPreferences('video/H264', { profiles: settings.video_profiles || [] }) // 4d = high, 42e = mid, 420 = low
            }

            // Stream is ready so we start the player
            xPlayer.setControllerRumble(settings.controller_vibration)
            xPlayer.setSdpHandler((client, offer) => {
                Ipc.send('streaming', 'sendChatSdp', {
                    sessionId: sessionId,
                    sdp: offer.sdp,
                }).then((sdpResponse) => {
                    xPlayer.setRemoteOffer(sdpResponse.sdp)

                }).catch((error) => {
                    console.log('ChatSDP Exchange error:', error)
                    alert(t('errors.chatSDPExchangeError') + ' ' + JSON.stringify(error))
                })
            })

            xPlayer.createOffer().then((offer:any) => {
                Ipc.send('streaming', 'sendSdp', {
                    sessionId: sessionId,
                    sdp: offer.sdp,
                }).then((sdpResult:any) => {
                    xPlayer.setRemoteOffer(sdpResult.sdp)

                    waitForLocalIce(xPlayer._webrtcClient, () => xPlayer.getIceCandidates()).then((iceCandidates) => {
                    const candidates = []
                    let skippedTcp = 0
                    for(const candidate in iceCandidates){
                        const line = iceCandidates[candidate].candidate || ''
                        if(/\stcp\s/i.test(line)){
                            skippedTcp++
                            continue
                        }
                        candidates.push({
                            candidate: line,
                            sdpMLineIndex: iceCandidates[candidate].sdpMLineIndex,
                            sdpMid: iceCandidates[candidate].sdpMid,
                        })
                    }
                    if(skippedTcp > 0){
                        logStreamPath(`skipped ${skippedTcp} tcp candidates so the stream stays on udp`)
                    }

                    Ipc.send('streaming', 'sendIce', {
                        sessionId: sessionId,
                        ice: candidates,
                    }).then((iceResult:any) => {
                        logIceList('remote', iceResult || [])
                        xPlayer.setIceCandidates(iceResult)

                        // All done. Waiting for the event 'connectionstate' to be triggered

                    }).catch((error) => {
                        console.log('ICE Exchange error:', error)
                        alert(t('errors.ICEExchangeError') + ' ' + JSON.stringify(error))
                    })
                    })

                }).catch((error) => {
                    console.log('SDP Exchange error:', error)
                    alert(t('errors.SDPExchangeError') + ' ' + JSON.stringify(error))
                })
            })

            xPlayer.getEventBus().on('connectionstate', (event) => {
                console.log('connectionstate changed:', event)

                const connStatus = document.getElementById('component_streamcomponent_connectionstatus')
                if(connStatus !== null){
                    if(event.state === 'connected'){
                        connStatus.innerText = t('streamWindow.clientHasBeenDisconnected')
                        document.getElementById('component_streamcomponent_loader').className = 'hidden'

                        // Set audio / Video settings
                        // @TODO: Implement api's in xbox-xcloud-player
                        if(settings.audio_enabled === false){
                            xPlayer._audioComponent._audioRender.muted = true
                        }

                        if(settings.video_enabled === false){
                            xPlayer._videoComponent._videoRender.style.opacity = 0
                        }

                        const logPath = () => {
                            if(xPlayer._webrtcClient){
                                applyLowLatencyReceivers(xPlayer._webrtcClient, true)
                                logSelectedIcePath(xPlayer._webrtcClient).catch((error) => {
                                    console.log('[stream-path] failed to read selected path', error)
                                })
                            }
                        }
                        if(xPlayer._webrtcClient){
                            applyLowLatencyReceivers(xPlayer._webrtcClient)
                        }
                        logPath()
                        clearInterval(pathLogInterval)
                        let pathLogCount = 0
                        pathLogInterval = setInterval(() => {
                            pathLogCount++
                            logPath()
                            if(pathLogCount >= 6){
                                clearInterval(pathLogInterval)
                            }
                        }, 5000)

                        // Start keepalive loop
                        keepaliveInterval = setInterval(() => {
                            Ipc.send('streaming', 'sendKeepalive', {
                                sessionId: sessionId,
                            }).then((result) => {
                                console.log('StartStream keepalive:', result)
                            }).catch((error) => {
                                console.error('Failed to send keepalive. Error details:\n'+JSON.stringify(error))
                            })
                        }, 30000) // Send every 30 seconds

                    } else if(event.state === 'new'){
                        connStatus.innerText = t('streamWindow.startingConnection')

                    } else if(event.state === 'connecting'){
                        connStatus.innerText = t('streamWindow.connectingToConsole')

                    } else if(event.state === 'closed') {
                        // Client has been disconnected. Lets return to home.
                        // xPlayer.close()
                        console.log('Client has been disconnected. Returning to prev page.')
                        window.history.back()
                    }
                }
            })
        } else if(sessionId === '') {
            // Stream is not ready yet, lets start it...

            Ipc.send('streaming', 'startStream', {
                type: streamType,
                target: serverId,
            }).then((result:string) => {
                console.log('StartStream session:', result)
                setSessionId(result)

            }).catch((error) => {
                alert(t('errors.failedToStartStream') + '\n' + JSON.stringify(error))
            })
        } else {

            streamStateInterval = setInterval(() => {
                Ipc.send('streaming', 'getPlayerState', {
                    sessionId: sessionId,
                }).then((session:any) => {
                    console.log('Player state:', session)

                    switch(session.playerState){
                        case 'pending':
                            // Waiting for console to start
                            break

                        case 'started':
                            // Console is ready
                            clearInterval(streamStateInterval)

                            // Start xPlayer interface
                            setxPlayer(new xCloudPlayer('streamComponent', {
                                // 31 is ShowApplication. An empty list tells the console this client
                                // cannot leave the dashboard, so a launched game never appears in the stream.
                                ui_systemui: [31],
                                input_touch: settings.input_touch || false,
                                input_mousekeyboard: settings.input_mousekeyboard || false,
                                input_legacykeyboard: (settings.input_newgamepad) ? false : true,
                                input_mousekeyboard_config: settings.input_mousekeyboard_config !== undefined ? {
                                    _keymapping: settings.input_mousekeyboard_config,
                                } : undefined as any,
                            }))
                            break

                        case 'failed':
                            // Error
                            clearInterval(streamStateInterval)

                            if(session.errorDetails.code === 'WNSError' && session.errorDetails.message.includes('WaitingForServerToRegister')){
                                // Detected the "WaitingForServerToRegister" error. This means the console is not connected to the xbox servers
                                alert(t('errors.unableToStartStreamSession') + '\n\n' + t('errors.streamErrorResult') + ' ' + session.state + '\n' + t('errors.details') + ' [' + session.errorDetails.code + '] ' + session.errorDetails.message)
                            } else {
                                alert(t('errors.streamErrorResult') + ' ' + session.state + '\n' + t('errors.details') + ' [' + session.errorDetails.code + '] ' + session.errorDetails.message)
                            }
                            console.log('Full stream error:', session.errorDetails)
                            onDisconnect()
                            xPlayer.close()
                            break

                        case 'queued':
                            // Waiting in queue
                            // @TODO: Show queue position
                            if(queueTime === 0){
                                setQueueTime(session.waitingTimes.estimatedTotalWaitTimeInSeconds)
                                console.log('Setting queue to:', session.waitingTimes.estimatedTotalWaitTimeInSeconds)


                            }
                            break
                    }

                }).catch((error) => {
                    alert(t('errors.failedToGetPlayerState') + '\n' + JSON.stringify(error))
                })
            }, 1000)
        }

        // Modal window
        return () => {
            stopFollowingPicture()
            restoreGamepad()

            if(xPlayer !== undefined){
                xPlayer.close()
            }

            if(keepaliveInterval){
                clearInterval(keepaliveInterval)
            }

            if(pathLogInterval){
                clearInterval(pathLogInterval)
            }

            if(streamStateInterval){
                clearInterval(streamStateInterval)
            }
        }
    })

    function gamepadSend(button){
        console.log('Pressed button:', button)
        xPlayer.getChannelProcessor('input').pressButton(0, 'Nexus')
    }

    function onDisconnect(){
        if(keepaliveInterval){
            clearInterval(keepaliveInterval)
            keepaliveInterval = undefined
        }

        Ipc.send('streaming', 'stopStream', {
            sessionId: sessionId,
        }).then((result) => {
            console.log('Stream stopped:', result)
        }).catch((error) => {
            console.log('Stream already ended:', error)
        })

        if(streamStateInterval){
            clearInterval(streamStateInterval)
        }
    }

    return (
        <React.Fragment>
            <Head>
                <title>Greenlight - {t('streamWindow.pageTitle')} {router.query.serverid}</title>
            </Head>

            { (xPlayer !== undefined) ? <StreamComponent onDisconnect={ () => {
                onDisconnect()
            }} onMenu={ () => {
                gamepadSend('nexus')
            } } xPlayer={ xPlayer }></StreamComponent> : (queueTime > 0) ?<StreamPreload onDisconnect={ () => {
                onDisconnect()
            }} waitingTime={ queueTime }></StreamPreload> : <StreamPreload onDisconnect={ () => {
                onDisconnect()
            }}></StreamPreload> }
        </React.Fragment>
    )
}

export default Stream
