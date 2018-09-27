class APU {
    private cycles: number = 0;
    private is4Step: boolean = true;
    private irqEnabled: boolean = true;

    private nes: NES;
    public static audio: AudioContext;
    public static triangle: TriangleChannel;

    constructor(nes: NES) {
        this.nes = nes;
        this.reset();
    }

    public reset() {
        //Silence channels
        this.notifyWrite(0x4015, 0);
        //Reset triangle registers
        APU.triangle.reset()
    }

    public read4015(): number {
        //Status
        let byte = 0;
        byte |= (this.nes.cpu.apuIRQ) ? 0x40 : 0;
        this.nes.cpu.apuIRQ = false; //Acknowledge IRQ
        return byte;
    }

    public notifyWrite(addr: number, data: number) {
        if (addr == 0x4008) {
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
            APU.triangle.length = lengthTable[(data & 0xF8) >> 3];
            APU.triangle.linearReload = true;
        } else if (addr == 0x4015) {
            //Status
            APU.triangle.enable = (data & 4) != 0;
            if (!APU.triangle.enable) APU.triangle.length = 0;
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

        //Turn triangle volume on and off
        if (APU.triangle.enable && APU.triangle.length != 0 &&
                APU.triangle.linearCount != 0) {
            //Should be on
            if (APU.triangle.getGain() != 1) {
                APU.triangle.setGain(1);
            }
        } else {
            //Should be off
            if (APU.triangle.getGain() != 0) {
                APU.triangle.setGain(0);
            }
        }
    }

    private clockQuarter() {
        APU.triangle.clockLinear();
    }

    private clockHalf() {
        APU.triangle.clockLength();
    }
}

// CHANNEL CLASSES BELOW
class AudioChannel {
    public period: number = 0;
    public length: number = 0;
    public haltLength: boolean = false;
    public enable: boolean = false;
    public targetGain: number = 0;
    public smoothing: number = 0.005; //Time to exp trans btwn volume, in seconds

    constructor(public osc: OscillatorNode, public gain: GainNode) {
        gain.gain.value = 0;
    }

    public clockLength() {
        if (this.haltLength || this.length == 0) return;
        --this.length;
    }

    public setPeriod(val: number) {
        if (val < 2) {
            //If the period is too low, silence the channel
            this.gain.gain.value = 0;
            this.period = val;
            return;
        } else if (this.period < 2) {
            //Restore the channel if it was silenced
            this.gain.gain.value = 1;
        }
        this.period = val;
        this.osc.frequency.value = (111860.8 + this.period) / this.period;
    }

    public setGain(val: number) {
        this.targetGain = val;
        this.gain.gain.setTargetAtTime(val, 0, this.smoothing);
    }

    public getGain(): number {
        return this.targetGain;
    }

    public reset() {
        this.length = 0;
        this.period = 0;
        this.haltLength = false;
        this.osc.frequency.value = 2400;
        this.gain.gain.value = 0;
        this.targetGain = 0;
    }
}

class TriangleChannel extends AudioChannel {
    public linearCount: number = 0;
    public reloadVal: number = 0;
    public linearReload: boolean = false;

    constructor(osc: OscillatorNode, gain: GainNode) {
        super(osc, gain);
    }

    public clockLinear() {
        if (this.linearReload) {
            this.linearCount = this.reloadVal;
        } else if (this.linearCount != 0) {
            --this.linearCount;
        }
        if (!this.haltLength) this.linearReload = false;
    }

    public setPeriod(val: number) {
        if (val < 2) {
            //If the period is too low, silence the channel
            this.gain.gain.value = 0;
            this.period = val;
            return;
        } else if (this.period < 2) {
            //Restore the channel if it was silenced
            this.gain.gain.value = 1;
        }
        this.period = val;
        this.osc.frequency.value = (55930.4 + this.period) / this.period;
    }

    public reset() {
        this.length = 0;
        this.period = 0;
        this.haltLength = false;
        this.osc.frequency.value = 2400;
        this.gain.gain.value = 0;
        this.targetGain = 0;
        this.linearCount = 0;
        this.reloadVal = 0;
        this.linearReload = false;
    }

}

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
