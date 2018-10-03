class APU {
    public static readonly FULL_DB = 0;
    public static readonly MUTE_DB = -Infinity;

    public cycles: number = 0;
    private is4Step: boolean = true;
    private irqEnabled: boolean = true;

    private nes: NES;
    public static pulse1: PulseChannel;
    public static pulse2: PulseChannel;
    public static triangle: TriangleChannel;
    public static noise: NoiseChannel;

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
        if (addr == 0x4000) {
            //Pulse 1 Duty/Volume
            APU.pulse1.setDuty((data & 0xC0) >> 6);
            APU.pulse1.haltLength = (data & 0x20) != 0;
            APU.pulse1.constantVol = (data & 0x10) != 0;
            APU.pulse1.v = data & 0xF;
        } else if (addr == 0x4001) {
            //TODO: Pulse 1 APU Sweep
            APU.pulse1.sweepEnabled = (data & 0x80) != 0;
            APU.pulse1.sweepNeg = (data & 8) != 0;
            APU.pulse1.sweepPeriod = ((data & 0x70) >> 4) + 1;
            APU.pulse1.sweepShift = data & 7;
            APU.pulse1.sweepReload = true;
        } else if (addr == 0x4002) {
            //Pulse 1 Period Low
            let period = APU.pulse1.period & 0x700;
            APU.pulse1.setPeriod(period | data);
        } else if (addr == 0x4003) {
            //Pulse 1 Length/Period High
            let period = APU.pulse1.period & 0xFF;
            APU.pulse1.setPeriod(((data & 7) << 8) | period);
            if (APU.pulse1.enable) APU.pulse1.length = lengthTable[(data & 0xF8) >> 3] + 1;
            APU.pulse1.envStart = true;
        } else if (addr == 0x4004) {
            //Pulse 2 Duty/Volume
            APU.pulse2.setDuty((data & 0xC0) >> 6);
            APU.pulse2.haltLength = (data & 0x20) != 0;
            APU.pulse2.constantVol = (data & 0x10) != 0;
            APU.pulse2.v = data & 0xF;
        } else if (addr == 0x4005) {
            //TODO: Pulse 2 APU Sweep
            APU.pulse2.sweepEnabled = (data & 0x80) != 0;
            APU.pulse2.sweepNeg = (data & 8) != 0;
            APU.pulse2.sweepPeriod = ((data & 0x70) >> 4) + 1;
            APU.pulse2.sweepShift = data & 7;
            APU.pulse2.sweepReload = true;
        } else if (addr == 0x4006) {
            //Pulse 2 Period Low
            let period = APU.pulse2.period & 0x700;
            APU.pulse2.setPeriod(period | data);
        } else if (addr == 0x4007) {
            //Pulse 2 Length/Period High
            let period = APU.pulse2.period & 0xFF;
            APU.pulse2.setPeriod(((data & 7) << 8) | period);
            if (APU.pulse2.enable) APU.pulse2.length = lengthTable[(data & 0xF8) >> 3] + 1;
            APU.pulse2.envStart = true;
        } else if (addr == 0x4008) {
            //Triangle Linear Counter
            APU.triangle.haltLength = (data & 0x80) != 0;
            APU.triangle.reloadVal = data & 0x7F;
        } else if (addr == 0x400A) {
            //Triangle Period Low
            let period = APU.triangle.period & 0x700;
            APU.triangle.setPeriod(period | data);
        } else if (addr == 0x400B) {
            //Triangle Length/Period High
            let period = APU.triangle.period & 0xFF;
            APU.triangle.setPeriod(((data & 7) << 8) | period);
            if (APU.triangle.enable) APU.triangle.length = lengthTable[(data & 0xF8) >> 3];
            APU.triangle.linearReload = true;
        } else if (addr == 0x400C) {
            //Noise Volume/Envelope
            APU.noise.haltLength = (data & 0x20) != 0;
            APU.noise.constantVol = (data & 0x10) != 0;
            APU.noise.v = data & 0xF;
        } else if (addr == 0x400E) {
            //Noise Period
            APU.noise.setPeriod(noiseTable[(data & 0xF)]);
        } else if (addr == 0x400F) {
            //Noise Length
            if (APU.noise.enable) APU.noise.length = lengthTable[(data & 0xF8) >> 3] + 1;
            APU.noise.envStart = true;
        } else if (addr == 0x4015) {
            //Status
            APU.triangle.enable = (data & 4) != 0;
            if (!APU.triangle.enable) APU.triangle.length = 0;
            APU.noise.enable = (data & 8) != 0;
            if (!APU.noise.enable) APU.noise.length = 0;
            APU.pulse2.enable = (data & 2) != 0;
            if (!APU.pulse2.enable) APU.pulse2.length = 0;
            APU.pulse1.enable = (data & 1) != 0;
            if (!APU.pulse1.enable) APU.pulse1.length = 0;
        } else if (addr == 0x4017) {
            //Frame Counter
            this.is4Step = (data & 0x80) == 0;
            if (!this.is4Step) {
                this.clockQuarter();
                this.clockHalf();
            }
            this.irqEnabled = (data & 0x40) == 0;
            if (!this.irqEnabled) this.nes.cpu.apuIRQ = false;
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
class AudioChannel {
    public period: number = 0;
    public length: number = 0;
    public haltLength: boolean = false;
    public enable: boolean = false;
    public targetVol: number = APU.MUTE_DB; //In dB
    public smoothing: number = 0.005; //Time to exp trans btwn volume, in seconds

    constructor(public node) {
        node.volume.value = APU.MUTE_DB; //Turn off volume before starting
    }

    public clockLength() {
        if (this.haltLength || this.length == 0) return;
        --this.length;
    }
}

class PulseChannel extends AudioChannel {
    public envStart: boolean = false;
    public constantVol: boolean = false;

    public sweepEnabled: boolean = false;
    public sweepReload: boolean = false;
    public sweepNeg: boolean = false;
    private sweepMute: boolean = false;
    private targetP: number = 0;
    public sweepPeriod: number = 0;
    private sweepDiv: number = 0;
    public sweepShift: number = 0;

    public v: number = 0;
    private currV: number = 0;
    private divider: number = 0;
    private decayCount: number = 0;
    private periodToFreq: number = 111860.8;

    constructor(osc, private isP2: boolean = false) {
        super(osc);
    }

    public setPeriod(val: number) {
        if (val < 8) {
            //If the period is too low, silence the channel
            this.node.volume.setTargetAtTime(APU.MUTE_DB, 0, this.smoothing);
            this.period = val;
            return;
        } else if (this.period < 8) {
            //Restore the channel if it was silenced
            if (this.constantVol) {
                this.node.volume.setTargetAtTime(this.gainToDb(this.v/15), 0, this.smoothing);
            } else {
                this.node.volume.setTargetAtTime(this.gainToDb(this.decayCount/15), 0, this.smoothing);
            }
        }
        this.period = val;
        this.node.frequency.value = (this.periodToFreq + this.period) / this.period;
    }

    public setDuty(val: number) {
        return;
        //TODO: Create Pulse Oscillator and set duty
        switch (val) {
            case 0: this.node.width.value = .12; break;
            case 1: this.node.width.value = .25; break;
            case 2: this.node.width.value = .50; break;
            case 3: this.node.width.value = .25; break;
        }
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
                    if (!this.isP2) p--;
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

    private gainToDb(val: number) {
        return 20*Math.log10(val);
    }

    public step() {
        if (this.enable && this.length != 0 && !this.sweepMute) {
            //Should produce sound
            if (this.constantVol) {
                if (this.currV != this.v) {
                    this.currV = this.v;
                    this.node.volume.setTargetAtTime(this.gainToDb(this.v/15), 0, this.smoothing);
                }
            } else {
                if (this.currV != this.decayCount) {
                    this.currV = this.decayCount;
                    this.node.volume.setTargetAtTime(this.gainToDb(this.decayCount/15), 0, this.smoothing);
                }
            }
        } else {
            //Should be quiet
            if (this.currV != 0) {
                this.currV = 0;
                this.node.volume.setTargetAtTime(APU.MUTE_DB, 0, this.smoothing);
            }
        }
    }

    public reset() {
        this.length = 0;
        this.period = 0;
        this.haltLength = false;
        this.node.frequency.value = 0;
        this.node.volume.value = APU.MUTE_DB;
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

    constructor(node) {
        super(node);
    }

    public setPeriod(val: number) {
        if (val < 2) {
            //If the period is too low, silence the channel
            this.node.volume.setTargetAtTime(APU.MUTE_DB, 0, this.smoothing);
            this.period = val;
            return;
        } else if (this.period < 2) {
            //Restore the channel if it was silenced
            this.node.volume.setTargetAtTime(APU.FULL_DB, 0, this.smoothing);
        }
        this.period = val;
        this.node.frequency.value = (this.periodToFreq + this.period) / this.period;
    }

    public clockLinear() {
        if (this.linearReload) {
            this.linearCount = this.reloadVal;
        } else if (this.linearCount != 0) {
            --this.linearCount;
        }
        if (!this.haltLength) this.linearReload = false;
    }

    public setGain(dB: number) {
        this.targetVol = dB;
        this.node.volume.setTargetAtTime(dB, 0, this.smoothing);
    }

    public getGain(): number {
        return this.targetVol;
    }

    public step() {
        //Turn triangle volume on and off
        if (this.enable && this.length != 0 &&
                this.linearCount != 0) {
            //Should be on
            if (this.getGain() != APU.FULL_DB) {
                this.setGain(APU.FULL_DB);
            }
        } else {
            //Should be off
            if (this.getGain() != APU.MUTE_DB) {
                this.setGain(APU.MUTE_DB);
            }
        }
    }

    public reset() {
        this.length = 0;
        this.period = 0;
        this.haltLength = false;
        this.node.frequency.value = 0;
        this.node.volume.value = APU.MUTE_DB;
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

    constructor(osc) {
        super(osc);
        this.smoothing = 0.001;
    }

    public setPeriod(val: number) {
        if (val < 8) {
            //If the period is too low, silence the channel
            this.node.volume.setTargetAtTime(APU.MUTE_DB, 0, this.smoothing);
            this.period = val;
            return;
        } else if (this.period < 8) {
            //Restore the channel if it was silenced
            if (this.constantVol) {
                this.node.volume.setTargetAtTime(this.gainToDb(this.v/15), 0, this.smoothing);
            } else {
                this.node.volume.setTargetAtTime(this.gainToDb(this.decayCount/15), 0, this.smoothing);
            }
        }
        this.period = val;
        //this.node.frequency.value = (this.periodToFreq + this.period) / this.period;
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

    private gainToDb(val: number) {
        return 20*Math.log10(val);
    }

    public step() {
        if (this.enable && this.length != 0) {
            //Should produce sound
            if (this.constantVol) {
                if (this.currV != this.v) {
                    this.currV = this.v;
                    this.node.volume.setTargetAtTime(this.gainToDb(this.v/15), 0, this.smoothing);
                }
            } else {
                if (this.currV != this.decayCount) {
                    this.currV = this.decayCount;
                    this.node.volume.setTargetAtTime(this.gainToDb(this.decayCount/15), 0, this.smoothing);
                }
            }
        } else {
            //Should be quiet
            if (this.currV != 0) {
                this.currV = 0;
                this.node.volume.setTargetAtTime(APU.MUTE_DB, 0, this.smoothing);
            }
        }
    }

    public reset() {
        this.length = 0;
        this.period = 0;
        this.haltLength = false;
        this.node.volume.value = APU.MUTE_DB;
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
