class APU {
    public cycles: number = 0;
    private is4Step: boolean = true;
    private irqEnabled: boolean = true;

    private nes: NES;
    public static pulse1: PulseChannel;
    public static pulse2: PulseChannel;
    public static triangle: TriangleChannel;
    public static noise: NoiseChannel;
    public static masterGain: GainNode;
    public static masterVol: number;

    constructor(nes: NES) {
        this.nes = nes;
        this.reset();
    }

    public reset() {
        //Silence channels
        this.notifyWrite(0x4015, 0);
        //Reset triangle registers
        APU.triangle.reset()
        APU.noise.reset();
        APU.pulse1.reset();
        APU.pulse2.reset();
    }

    public getState(): object {
      let obj = {};
      let ignoreList = ["nes"];
      let keys = Object.keys(this);
      for (let i = 0; i < keys.length; i++) {
        if (ignoreList.includes(keys[i])) continue;
        obj[keys[i]] = this[keys[i]];
      }
      //Static variables
      obj["static"] = {};
      keys = Object.keys(APU);
      ignoreList = ["osc", "gain", "smoothing", "periodToFreq", "isP1"];
      for (let i = 0; i < keys.length; i++) {
        if (keys[i] == "masterGain" || keys[i] == "masterVol") continue;
        let subObj = APU[keys[i]];
        let subKeys = Object.keys(subObj);
        obj["static"][keys[i]] = {};
        for (let j = 0; j < subKeys.length; j++) {
          if (ignoreList.includes(subKeys[j])) continue;
          obj["static"][keys[i]][subKeys[j]] = subObj[subKeys[j]];
        }
      }
      return obj;
    }

    public loadState(state: object) {
      //Static variables
      let keys = Object.keys(state["static"]);
      for (let i = 0; i < keys.length; i++) {
        let key = keys[i];
        let sKeys = Object.keys(state["static"][key]);
        for (let j = 0; j < sKeys.length; j++) {
          APU[key][sKeys[j]] = state["static"][key][sKeys[j]];
        }
      }
      keys = Object.keys(state);
      for (let i = 0; i < keys.length; i++) {
        if (keys[i] == "static") continue;
        this[keys[i]] = state[keys[i]];
      }
    }

    public read4015(): number {
        //Status
        let byte = 0;
        byte |= (this.nes.cpu.apuIRQ) ? 0x40 : 0;
        byte |= (APU.noise.length > 0) ? 8 : 0;
        byte |= (APU.triangle.length > 0) ? 4 : 0;
        byte |= (APU.pulse2.length > 0) ? 2 : 0;
        byte |= (APU.pulse1.length > 0) ? 1 : 0;
        this.nes.cpu.apuIRQ = false; //Acknowledge IRQ
        return byte;
    }

    public notifyWrite(addr: number, data: number) {
        let period: number;
        switch (addr) {
            case 0x4000:
                //Pulse 1 Duty/Volume
                APU.pulse1.setDuty((data & 0xC0) >> 6);
                APU.pulse1.haltLength = (data & 0x20) != 0;
                APU.pulse1.constantVol = (data & 0x10) != 0;
                APU.pulse1.v = data & 0xF;
                break;
            case 0x4001:
                //Pulse 1 APU Sweep
                APU.pulse1.sweepEnabled = (data & 0x80) != 0;
                APU.pulse1.sweepNeg = (data & 8) != 0;
                APU.pulse1.sweepPeriod = ((data & 0x70) >> 4) + 1;
                APU.pulse1.sweepShift = data & 7;
                APU.pulse1.sweepReload = true;
                break;
            case 0x4002:
                //Pulse 1 Period Low
                period = APU.pulse1.period & 0x700;
                APU.pulse1.setPeriod(period | data);
                break;
            case 0x4003:
                //Pulse 1 Length/Period High
                period = APU.pulse1.period & 0xFF;
                APU.pulse1.setPeriod(((data & 7) << 8) | period);
                if (APU.pulse1.enable) APU.pulse1.length = lengthTable[(data & 0xF8) >> 3] + 1;
                APU.pulse1.envStart = true;
                break;
            case 0x4004:
                //Pulse 2 Duty/Volume
                APU.pulse2.setDuty((data & 0xC0) >> 6);
                APU.pulse2.haltLength = (data & 0x20) != 0;
                APU.pulse2.constantVol = (data & 0x10) != 0;
                APU.pulse2.v = data & 0xF;
                break;
            case 0x4005:
                //Pulse 2 APU Sweep
                APU.pulse2.sweepEnabled = (data & 0x80) != 0;
                APU.pulse2.sweepNeg = (data & 8) != 0;
                APU.pulse2.sweepPeriod = ((data & 0x70) >> 4) + 1;
                APU.pulse2.sweepShift = data & 7;
                APU.pulse2.sweepReload = true;
                break;
            case 0x4006:
                //Pulse 2 Period Low
                period = APU.pulse2.period & 0x700;
                APU.pulse2.setPeriod(period | data);
                break;
            case 0x4007:
                //Pulse 2 Length/Period High
                period = APU.pulse2.period & 0xFF;
                APU.pulse2.setPeriod(((data & 7) << 8) | period);
                if (APU.pulse2.enable) APU.pulse2.length = lengthTable[(data & 0xF8) >> 3] + 1;
                APU.pulse2.envStart = true;
                break;
            case 0x4008:
                //Triangle Linear Counter
                APU.triangle.haltLength = (data & 0x80) != 0;
                APU.triangle.reloadVal = data & 0x7F;
                break;
            case 0x400A:
                //Triangle Period Low
                period = APU.triangle.period & 0x700;
                APU.triangle.setPeriod(period | data);
                break;
            case 0x400B:
                //Triangle Length/Period High
                period = APU.triangle.period & 0xFF;
                APU.triangle.setPeriod(((data & 7) << 8) | period);
                if (APU.triangle.enable) APU.triangle.length = lengthTable[(data & 0xF8) >> 3];
                APU.triangle.linearReload = true;
                break;
            case 0x400C:
                //Noise Volume/Envelope
                APU.noise.haltLength = (data & 0x20) != 0;
                APU.noise.constantVol = (data & 0x10) != 0;
                APU.noise.v = data & 0xF;
                break;
            case 0x400E:
                //Noise Period
                APU.noise.setPeriod(noiseTable[(data & 0xF)]);
                break;
            case 0x400F:
                //Noise Length
                if (APU.noise.enable) APU.noise.length = lengthTable[(data & 0xF8) >> 3] + 1;
                APU.noise.envStart = true;
                break;
            case 0x4015:
                //Status
                APU.triangle.enable = (data & 4) != 0;
                if (!APU.triangle.enable) APU.triangle.length = 0;
                APU.noise.enable = (data & 8) != 0;
                if (!APU.noise.enable) APU.noise.length = 0;
                APU.pulse2.enable = (data & 2) != 0;
                if (!APU.pulse2.enable) APU.pulse2.length = 0;
                APU.pulse1.enable = (data & 1) != 0;
                if (!APU.pulse1.enable) APU.pulse1.length = 0;
                break;
            case 0x4017:
                //Frame Counter
                this.is4Step = (data & 0x80) == 0;
                if (!this.is4Step) {
                    this.clockQuarter();
                    this.clockHalf();
                }
                this.irqEnabled = (data & 0x40) == 0;
                if (!this.irqEnabled) this.nes.cpu.apuIRQ = false;
                break;
        }
    }

    //Each call is 1/2 APU cycle
    public step() {
        this.cycles += 0.5;
        //Both 4 and 5-Step share the first 3 steps
        if (this.cycles == 3728.5) {
            this.clockQuarter();
        } else if (this.cycles == 7456.5) {
            this.clockQuarter();
            this.clockHalf();
        } else if (this.cycles == 11185.5) {
            this.clockQuarter();
        }
        if (this.is4Step) {
            //4-Step Mode
            if (this.cycles == 14914.5) {
                this.clockQuarter();
                this.clockHalf();
            } else if (this.cycles == 14915) {
                if (this.irqEnabled) {
                    this.nes.cpu.apuIRQ = true;
                }
                this.cycles = 0;
            }
        } else {
            //5-Step Mode
            if (this.cycles == 18640.5) {
                this.clockQuarter();
                this.clockHalf();
            } else if (this.cycles == 18641) {
                this.cycles = 0;
            }
        }

        APU.triangle.step();
        APU.noise.step();
        APU.pulse1.step();
        APU.pulse2.step();
    }

    private clockQuarter() {
        APU.noise.clockEnv();
        APU.triangle.clockLinear();
        APU.pulse1.clockEnv();
        APU.pulse2.clockEnv();
    }

    private clockHalf() {
        APU.noise.clockLength();
        APU.triangle.clockLength();
        APU.pulse1.clockLength();
        APU.pulse1.clockSweep();
        APU.pulse2.clockLength();
        APU.pulse2.clockSweep();
    }
}



// CHANNEL CLASSES BELOW
abstract class AudioChannel {
    public period: number = 0;
    public length: number = 0;
    public haltLength: boolean = false;
    public enable: boolean = false;
    public targetVol: number = 0; //In dB
    public smoothing: number = 0.005; //Time to exp trans btwn volume, in seconds
    public osc;

    constructor(public gain: GainNode) {
        gain.gain.value = 0; //Turn off volume before starting
    }

    public clockLength() {
        if (this.haltLength || this.length == 0) return;
        --this.length;
    }

    abstract step(): void;

    abstract reset(): void;
}

class PulseChannel extends AudioChannel {
    public envStart: boolean = false;
    public constantVol: boolean = false;

    public sweepEnabled: boolean = false;
    public sweepReload: boolean = false;
    public sweepNeg: boolean = false;
    private sweepMute: boolean = false;
    public sweepPeriod: number = 0;
    private sweepDiv: number = 0;
    public sweepShift: number = 0;

    public v: number = 0;
    private currV: number = 0;
    private divider: number = 0;
    private decayCount: number = 0;
    private periodToFreq: number = 111860.8;

    constructor(public osc: OscillatorNode, gain: GainNode, private isP1: boolean = true) {
        super(gain);
    }

    public setPeriod(val: number) {
        this.period = val;
        if (val < 8) return;
        this.osc.frequency.value = (this.periodToFreq + this.period) / this.period;
    }

    public setDuty(val: number) {
        //TODO: Create Pulse Oscillator and set duty
        return;
    }

    public clockSweep() {
        this.sweepMute = (!this.sweepNeg && this.sweepShift == 0 && this.period >= 0x400);
        //Adj div/clock changes
        if (this.sweepReload) {
            this.sweepDiv = this.sweepPeriod;
            this.sweepReload = false;
        }
        if (this.sweepDiv == 0) {
            this.sweepDiv = this.sweepPeriod;
            if (this.sweepEnabled && !this.sweepMute) {
                //Shift Sweep
                let p = this.period >> this.sweepShift;
                if (this.sweepNeg && p != 0) {
                    p *= -1;
                    if (this.isP1) p--;
                }
                this.setPeriod(this.period + p);
            }
        } else {
            this.sweepDiv--;
        }
    }

    public clockEnv() {
        if (!this.envStart) {
            //Dec divider
            if (this.divider-- == 0) {
                this.divider = this.v;
                //Clock decayCount
                if (this.decayCount > 0) {
                    this.decayCount--;
                } else if (this.haltLength) {
                    this.decayCount = 15;
                }
            }
        } else {
            this.envStart = false;
            this.decayCount = 15;
            this.divider = this.v;
        }
    }

    public step() {
        if (this.enable && this.length != 0 && !this.sweepMute && this.period >= 8) {
            //Should produce sound
            if (this.constantVol) {
                if (this.currV != this.v) {
                    this.currV = this.v;
                    this.gain.gain.setTargetAtTime(this.v/15, 0, this.smoothing);
                }
            } else {
                if (this.currV != this.decayCount) {
                    this.currV = this.decayCount;
                    this.gain.gain.setTargetAtTime(this.decayCount/15, 0, this.smoothing);
                }
            }
        } else {
            //Should be quiet
            if (this.currV != 0) {
                this.currV = 0;
                this.gain.gain.setTargetAtTime(0, 0, this.smoothing);
            }
        }
    }

    public reset() {
        this.length = 0;
        this.period = 0;
        this.haltLength = false;
        this.osc.frequency.value = 0;
        this.gain.gain.value = 0;
        this.targetVol = 0;
        this.envStart = false;
        this.constantVol = false;
        this.v = 0;
        this.currV = 0;
        this.divider = 0;
        this.decayCount = 0;
    }
}

class TriangleChannel extends AudioChannel {
    public linearCount: number = 0;
    public reloadVal: number = 0;
    public linearReload: boolean = false;
    private periodToFreq: number = 55930.4;

    constructor(public osc: OscillatorNode, gain: GainNode) {
        super(gain);
    }

    public setPeriod(val: number) {
        this.period = val;
        if (val < 2) return;
        this.osc.frequency.value = (this.periodToFreq + this.period) / this.period;
    }

    public clockLinear() {
        if (this.linearReload) {
            this.linearCount = this.reloadVal;
        } else if (this.linearCount != 0) {
            --this.linearCount;
        }
        if (!this.haltLength) this.linearReload = false;
    }

    public setGain(val: number) {
        this.targetVol = val;
        this.gain.gain.setTargetAtTime(val, 0, this.smoothing);
    }

    public getGain(): number {
        return this.targetVol;
    }

    public step() {
        //Turn triangle volume on and off
        if (this.enable && this.length != 0 && this.linearCount != 0 && this.period >= 2) {
            //Should be on
            if (this.getGain() != 1) {
                this.setGain(1);
            }
        } else {
            //Should be off
            if (this.getGain() != 0) {
                this.setGain(0);
            }
        }
    }

    public reset() {
        this.length = 0;
        this.period = 0;
        this.haltLength = false;
        this.osc.frequency.value = 0;
        this.gain.gain.value = 0;
        this.targetVol = 0;
        this.linearCount = 0;
        this.reloadVal = 0;
        this.linearReload = false;
    }
}

class NoiseChannel extends AudioChannel {
    public envStart: boolean = false;
    public constantVol: boolean = false;
    public v: number = 0;
    private currV: number = 0;
    private divider: number = 0;
    private decayCount: number = 0;

    constructor(public osc: AudioBufferSourceNode, gain: GainNode) {
        super(gain);
        this.smoothing = 0.001;
    }

    public setPeriod(val: number) {
        this.period = val;
    }

    public clockEnv() {
        if (!this.envStart) {
            //Dec divider
            if (this.divider-- == 0) {
                this.divider = this.v;
                //Clock decayCount
                if (this.decayCount > 0) {
                    this.decayCount--;
                } else if (this.haltLength) {
                    this.decayCount = 15;
                }
            }
        } else {
            this.envStart = false;
            this.decayCount = 15;
            this.divider = this.v;
        }
    }

    public step() {
        if (this.enable && this.length != 0 && this.period >= 8) {
            //Should produce sound
            if (this.constantVol) {
                if (this.currV != this.v) {
                    this.currV = this.v;
                    this.gain.gain.setTargetAtTime(this.v/15, 0, this.smoothing);
                }
            } else {
                if (this.currV != this.decayCount) {
                    this.currV = this.decayCount;
                    this.gain.gain.setTargetAtTime(this.decayCount/15, 0, this.smoothing);
                }
            }
        } else {
            //Should be quiet
            if (this.currV != 0) {
                this.currV = 0;
                this.gain.gain.setTargetAtTime(0, 0, this.smoothing);
            }
        }
    }

    public reset() {
        this.length = 0;
        this.period = 0;
        this.haltLength = false;
        this.gain.gain.value = 0;
        this.targetVol = 0;
        this.envStart = false;
        this.constantVol = false;
        this.v = 0;
        this.currV = 0;
        this.divider = 0;
        this.decayCount = 0;
    }
}

//Length Lookup Table
let lengthTable = [];
lengthTable[0x1F] = 30;
lengthTable[0x1D] = 28;
lengthTable[0x1B] = 26;
lengthTable[0x19] = 24;
lengthTable[0x17] = 22;
lengthTable[0x15] = 20;
lengthTable[0x13] = 18;
lengthTable[0x11] = 16;
lengthTable[0x0F] = 14;
lengthTable[0x0D] = 12;
lengthTable[0x0B] = 10;
lengthTable[0x09] = 8;
lengthTable[0x07] = 6;
lengthTable[0x05] = 4;
lengthTable[0x03] = 2;
lengthTable[0x01] = 254;
lengthTable[0x1E] = 32;
lengthTable[0x1C] = 16;
lengthTable[0x1A] = 72;
lengthTable[0x18] = 192;
lengthTable[0x16] = 96;
lengthTable[0x14] = 48;
lengthTable[0x12] = 24;
lengthTable[0x10] = 12;
lengthTable[0x0E] = 26;
lengthTable[0x0C] = 14;
lengthTable[0x0A] = 60;
lengthTable[0x08] = 160;
lengthTable[0x06] = 80;
lengthTable[0x04] = 40;
lengthTable[0x02] = 20;
lengthTable[0x00] = 10;

//Noise Period Lookup Table
let noiseTable = [4, 8, 16, 32, 64, 96, 128, 160, 202, 254, 380, 508, 762, 1016, 2034, 4068];
