//Node Modules:
import * as os from 'os'; // Used to display (log) network addresses on local machine
import * as osc from 'osc'; //Using OSC fork from PieceMeta/osc.js as it has excluded hardware serialport support and thereby is crossplatform

//Utils:
import { IMixerProtocol } from '../constants/MixerProtocolInterface';
import { behringerMeter } from './productSpecific/behringer';
import { midasMeter } from './productSpecific/midas';
import { IStore } from '../reducers/indexReducer';
import { SET_OUTPUT_LEVEL } from '../reducers/channelActions'
import { 
    SET_VU_LEVEL, 
    SET_FADER_LEVEL,
    SET_CHANNEL_LABEL,
    TOGGLE_PGM
} from '../reducers/faderActions'
import { SET_MIXER_ONLINE } from '../reducers/settingsActions';

export class OscMixerConnection {
    store: IStore;
    mixerProtocol: IMixerProtocol;
    cmdChannelIndex: number;
    oscConnection: any;
    mixerOnlineTimer: any;

    constructor(mixerProtocol: IMixerProtocol) {
        this.sendOutMessage = this.sendOutMessage.bind(this);
        this.pingMixerCommand = this.pingMixerCommand.bind(this);

        this.store = window.storeRedux.getState();
        const unsubscribe = window.storeRedux.subscribe(() => {
            this.store = window.storeRedux.getState();
        });


        window.storeRedux.dispatch({
            type: SET_MIXER_ONLINE,
            mixerOnline: false
        });

        this.mixerProtocol = mixerProtocol;

        this.cmdChannelIndex = this.mixerProtocol.channelTypes[0].fromMixer.CHANNEL_OUT_GAIN[0].mixerMessage.split('/').findIndex(ch => ch==='{channel}');

        this.oscConnection = new osc.UDPPort({
            localAddress: this.store.settings[0].localIp,
            localPort: parseInt(this.store.settings[0].localOscPort + ''),
            remoteAddress: this.store.settings[0].deviceIp,
            remotePort: parseInt(this.store.settings[0].devicePort + '')
        });
        this.setupMixerConnection();
    }

    setupMixerConnection() {
        this.oscConnection
        .on("ready", () => {
            console.log("Receiving state of desk");
            window.storeRedux.dispatch({
                type: SET_MIXER_ONLINE,
                mixerOnline: true
            });
            
            this.mixerProtocol.initializeCommands.map((item) => {
                if (item.mixerMessage.includes("{channel}")) {
                    this.store.channels[0].channel.map((channel: any, index: any) => {
                        this.sendOutRequest(item.mixerMessage,(index +1));
                    });
                } else {
                    this.sendOutMessage(item.mixerMessage, 1, item.value, item.type);
                }
            });
        })
        .on('message', (message: any) => {
            clearTimeout(this.mixerOnlineTimer)
            window.storeRedux.dispatch({
                type: SET_MIXER_ONLINE,
                mixerOnline: true
            });
            if (this.checkOscCommand(message.address, this.mixerProtocol.channelTypes[0].fromMixer
                .CHANNEL_VU[0].mixerMessage)){
                if (this.store.settings[0].mixerProtocol.includes('behringer')) {
                    behringerMeter(message.args);
                } else if (this.store.settings[0].mixerProtocol.includes('midas')) {
                    midasMeter(message.args);
                } else {
                    let ch = message.address.split("/")[this.cmdChannelIndex];
                    window.storeRedux.dispatch({
                        type:SET_VU_LEVEL,
                        channel: this.store.channels[0].channel[ch - 1].assignedFader,
                        level: message.args[0]
                    });
                }
            } else if ( this.checkOscCommand(message.address, this.mixerProtocol.channelTypes[0].fromMixer
                .CHANNEL_FADER_LEVEL[0].mixerMessage)){
                let ch = message.address.split("/")[this.cmdChannelIndex];
                let assignedFader = 1 + this.store.channels[0].channel[ch - 1].assignedFader

                window.storeRedux.dispatch({
                    type: SET_FADER_LEVEL,
                    channel: assignedFader - 1,
                    level: message.args[0]
                });


                if (this.store.faders[0].fader[assignedFader - 1].pgmOn)
                {
                    this.store.channels[0].channel.map((channel: any, index: number) => {
                        if (channel.assignedFader === assignedFader - 1) {
                            window.storeRedux.dispatch({
                                type:SET_OUTPUT_LEVEL,
                                channel: index,
                                level: message.args[0]
                            });
                            this.updateFadeIOLevel(index, this.store.faders[0].fader[assignedFader - 1].faderLevel);
                        }
                    })
                }

                if (!this.store.faders[0].fader[assignedFader - 1].pgmOn) {
                    window.storeRedux.dispatch({
                        type: TOGGLE_PGM,
                        channel: assignedFader - 1
                    });
                }

                if (window.huiRemoteConnection) {
                    window.huiRemoteConnection.updateRemoteFaderState(assignedFader-1, message.args[0]);
                }
            } else if ( this.checkOscCommand(message.address, this.mixerProtocol.channelTypes[0].fromMixer
                .CHANNEL_OUT_GAIN[0].mixerMessage)){
                let ch = message.address.split("/")[this.cmdChannelIndex];
                let assignedFaderIndex = this.store.channels[0].channel[ch - 1].assignedFader


                if (this.mixerProtocol.mode === 'master'
                    && !this.store.channels[0].channel[ch - 1].fadeActive)
                    {                    
                    if  (message.args[0] > this.mixerProtocol.fader.min + (this.mixerProtocol.fader.max * this.store.settings[0].autoResetLevel / 100)) {
                        window.storeRedux.dispatch({
                            type: SET_FADER_LEVEL,
                            channel: assignedFaderIndex,
                            level: message.args[0]
                        });
                        this.store.channels[0].channel.forEach((item, index) => {
                            if (item.assignedFader === assignedFaderIndex) {
                                window.storeRedux.dispatch({
                                    type: SET_OUTPUT_LEVEL,
                                    channel: index,
                                    level: message.args[0]
                                });
                            }
                        })
                        if (!this.store.faders[0].fader[assignedFaderIndex].pgmOn) {
                            if (message.args[0] > this.mixerProtocol.fader.min) {
                                window.storeRedux.dispatch({
                                    type: TOGGLE_PGM,
                                    channel: assignedFaderIndex
                                });
                            }
                        }
                    } else if (this.store.faders[0].fader[assignedFaderIndex].pgmOn 
                            || this.store.faders[0].fader[assignedFaderIndex].voOn)
                        {
                        window.storeRedux.dispatch({
                            type: SET_FADER_LEVEL,
                            channel: assignedFaderIndex,
                            level: message.args[0]
                        });
                        this.store.channels[0].channel.forEach((item, index) => {
                            if (item.assignedFader === assignedFaderIndex) {
                                window.storeRedux.dispatch({
                                    type: SET_OUTPUT_LEVEL,
                                    channel: index,
                                    level: message.args[0]
                                });
                            }
                        })
                    }
                    if (window.huiRemoteConnection) {
                        window.huiRemoteConnection.updateRemoteFaderState(assignedFaderIndex, message.args[0]);
                    }
                } 
            } else if (this.checkOscCommand(message.address, this.mixerProtocol.channelTypes[0].fromMixer
                .CHANNEL_NAME[0].mixerMessage)) {
                                    let ch = message.address.split("/")[this.cmdChannelIndex];
                    window.storeRedux.dispatch({
                        type: SET_CHANNEL_LABEL,
                        channel: this.store.channels[0].channel[ch - 1].assignedFader,
                        label: message.args[0]
                    });
                console.log("OSC message: ", message.address);
            }
        })
        .on('error', (error: any) => {
            window.storeRedux.dispatch({
                type: SET_MIXER_ONLINE,
                mixerOnline: false
            });
            console.log("Error : ", error);
            console.log("Lost OSC connection");
        });

        this.oscConnection.open();
        console.log(`OSC listening on port ` + this.store.settings[0].localOscPort );

        //Ping OSC mixer if mixerProtocol needs it.
        if (this.mixerProtocol.pingTime > 0) {
            let oscTimer = setInterval(
                () => {
                    this.pingMixerCommand();
                },
                this.mixerProtocol.pingTime
            );
        }
    }

    pingMixerCommand() {
         //Ping OSC mixer if mixerProtocol needs it.
         this.mixerProtocol.pingCommand.map((command) => {
            this.sendOutMessage(
                command.mixerMessage,
                0,
                command.value,
                command.type
            );
        });
        this.mixerOnlineTimer = setTimeout(() => {
            window.storeRedux.dispatch({
                type: SET_MIXER_ONLINE,
                mixerOnline: false
            });
        }, this.mixerProtocol.pingTime)
    }

    checkOscCommand(message: string, command: string) {
        if (message === command) return true;

        let cmdArray = command.split("{channel}");
        if (message.substr(0, cmdArray[0].length) === cmdArray[0])
        {
            if (
                message.substr(-cmdArray[1].length) === cmdArray[1] &&
                message.length >= command.replace("{channel}", "").length
            ) {
                return true;
            } else if (
                cmdArray[1] === "" &&
                message.length >= command.replace("{channel}", "").length
            ) {
                return true;
            }
        }
        return false;
    }

    sendOutMessage(oscMessage: string, channel: number, value: string | number, type: string) {
        let channelString = this.mixerProtocol.leadingZeros ? ("0"+channel).slice(-2) : channel.toString();
        let message = oscMessage.replace(
                "{channel}",
                channelString
            );
        if (message != 'none') {
            this.oscConnection.send({
                address: message,
                args: [
                    {
                        type: type,
                        value: value
                    }
                ]
            });
        }
    }


    sendOutRequest(oscMessage: string, channel: number) {
        let channelString = this.mixerProtocol.leadingZeros ? ("0"+channel).slice(-2) : channel.toString();
        let message = oscMessage.replace(
                "{channel}",
                channelString
            );
        if (message != 'none') {
            this.oscConnection.send({
                address: message
            });
        }
    }

    updateOutLevel(channelIndex: number) {
        let channelType = this.store.channels[0].channel[channelIndex].channelType;
        let channelTypeIndex = this.store.channels[0].channel[channelIndex].channelTypeIndex;
        this.sendOutMessage(
            this.mixerProtocol.channelTypes[channelType].toMixer.CHANNEL_OUT_GAIN[0].mixerMessage,
            channelTypeIndex+1,
            this.store.channels[0].channel[channelIndex].outputLevel,
            "f"
        );
    }

    updatePflState(channelIndex: number) {
        let channelType = this.store.channels[0].channel[channelIndex].channelType;
        let channelTypeIndex = this.store.channels[0].channel[channelIndex].channelTypeIndex;
        if (this.store.faders[0].fader[channelIndex].pflOn === true) {
            this.sendOutMessage(
                this.mixerProtocol.channelTypes[channelType].toMixer.PFL_ON[0].mixerMessage,
                channelTypeIndex+1,
                this.mixerProtocol.channelTypes[channelType].toMixer.PFL_ON[0].value,
                this.mixerProtocol.channelTypes[channelType].toMixer.PFL_ON[0].type
            );
        } else {
            this.sendOutMessage(
                this.mixerProtocol.channelTypes[channelType].toMixer.PFL_OFF[0].mixerMessage,
                channelTypeIndex+1,
                this.mixerProtocol.channelTypes[channelType].toMixer.PFL_OFF[0].value,
                this.mixerProtocol.channelTypes[channelType].toMixer.PFL_OFF[0].type
            );
        }
    }

    updateMuteState(channelIndex: number, muteOn: boolean) {
        return true
    } 

    updateNextAux(channelIndex: number, level: number) {
        return true
    }

    updateThreshold(channelIndex: number, level: number) {
        let channelType = this.store.channels[0].channel[channelIndex].channelType;
        let channelTypeIndex = this.store.channels[0].channel[channelIndex].channelTypeIndex;
        let thr = this.mixerProtocol.channelTypes[channelType].toMixer.THRESHOLD[0]
        level = level * (thr.max-thr.min) + thr.min
        this.sendOutMessage(
            this.mixerProtocol.channelTypes[channelType].toMixer.THRESHOLD[0].mixerMessage,
            channelTypeIndex+1,
            level,
            "f"
        );
    }

    
    updateFadeIOLevel(channelIndex: number, outputLevel: number) {
        let channelType = this.store.channels[0].channel[channelIndex].channelType;
        let channelTypeIndex = this.store.channels[0].channel[channelIndex].channelTypeIndex;
        this.sendOutMessage(
            this.mixerProtocol.channelTypes[channelType].toMixer.CHANNEL_OUT_GAIN[0].mixerMessage,
            channelTypeIndex+1,
            String(outputLevel),
            "f"
        );
    }

    updateChannelName(channelIndex: number) {
        let channelType = this.store.channels[0].channel[channelIndex].channelType;
        let channelTypeIndex = this.store.channels[0].channel[channelIndex].channelTypeIndex;
        let channelName = this.store.faders[0].fader[channelIndex].label;
        this.sendOutMessage(
            this.mixerProtocol.channelTypes[channelType].toMixer.CHANNEL_NAME[0].mixerMessage,
            channelTypeIndex+1,
            channelName,
            "s"
        );
    }
}

