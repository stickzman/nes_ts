class APU {
    constructor(nes) {
        this.cycles = 0;
        this.is4Step = true;
        this.irqEnabled = true;
        this.nes = nes;
        this.reset();
    }
    reset() {
        //Reset channel registers
        APU.pulse1 = new PulseChannel(APU.pulse1.osc, APU.pulse1.gain);
        APU.pulse2 = new PulseChannel(APU.pulse2.osc, APU.pulse2.gain, false);
        APU.triangle = new TriangleChannel(APU.triangle.osc, APU.triangle.gain);
        APU.noise = new NoiseChannel(APU.noise.osc, APU.noise.gain);
        //Silence channels
        this.notifyWrite(0x4015, 0);
    }
    getState() {
        let obj = {};
        let ignoreList = ["nes"];
        let keys = Object.keys(this);
        for (let i = 0; i < keys.length; i++) {
            if (ignoreList.includes(keys[i]))
                continue;
            obj[keys[i]] = this[keys[i]];
        }
        //Static variables
        obj["static"] = {};
        keys = Object.keys(APU);
        ignoreList = ["osc", "gain", "smoothing", "periodToFreq", "isP1"];
        for (let i = 0; i < keys.length; i++) {
            if (keys[i] == "masterGain" || keys[i] == "masterVol")
                continue;
            let subObj = APU[keys[i]];
            let subKeys = Object.keys(subObj);
            obj["static"][keys[i]] = {};
            for (let j = 0; j < subKeys.length; j++) {
                if (ignoreList.includes(subKeys[j]))
                    continue;
                obj["static"][keys[i]][subKeys[j]] = subObj[subKeys[j]];
            }
        }
        return obj;
    }
    loadState(state) {
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
            if (keys[i] == "static")
                continue;
            this[keys[i]] = state[keys[i]];
        }
        this.resetOscState();
    }
    resetOscState() {
        APU.pulse1.setPeriod(APU.pulse1.period);
        APU.pulse2.setPeriod(APU.pulse2.period);
        APU.triangle.setPeriod(APU.triangle.period);
        APU.noise.setPeriod(APU.noise.period);
        //Correct oscillators' volume
        APU.pulse1.forceCorrectGain();
        APU.pulse2.forceCorrectGain();
        APU.triangle.forceCorrectGain();
        APU.noise.forceCorrectGain();
    }
    read4015() {
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
    notifyWrite(addr, data) {
        let period;
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
                if (APU.pulse1.enable)
                    APU.pulse1.length = lengthTable[(data & 0xF8) >> 3] + 1;
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
                if (APU.pulse2.enable)
                    APU.pulse2.length = lengthTable[(data & 0xF8) >> 3] + 1;
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
                if (APU.triangle.enable)
                    APU.triangle.length = lengthTable[(data & 0xF8) >> 3];
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
                if (APU.noise.enable)
                    APU.noise.length = lengthTable[(data & 0xF8) >> 3] + 1;
                APU.noise.envStart = true;
                break;
            case 0x4015:
                //Status
                APU.triangle.enable = (data & 4) != 0;
                if (!APU.triangle.enable)
                    APU.triangle.length = 0;
                APU.noise.enable = (data & 8) != 0;
                if (!APU.noise.enable)
                    APU.noise.length = 0;
                APU.pulse2.enable = (data & 2) != 0;
                if (!APU.pulse2.enable)
                    APU.pulse2.length = 0;
                APU.pulse1.enable = (data & 1) != 0;
                if (!APU.pulse1.enable)
                    APU.pulse1.length = 0;
                break;
            case 0x4017:
                //Frame Counter
                this.is4Step = (data & 0x80) == 0;
                if (!this.is4Step) {
                    this.clockQuarter();
                    this.clockHalf();
                }
                this.irqEnabled = (data & 0x40) == 0;
                if (!this.irqEnabled)
                    this.nes.cpu.apuIRQ = false;
                break;
        }
    }
    //Each call is 1/2 APU cycle
    step() {
        this.cycles += 0.5;
        //Both 4 and 5-Step share the first 3 steps
        if (this.cycles == 3728.5) {
            this.clockQuarter();
        }
        else if (this.cycles == 7456.5) {
            this.clockQuarter();
            this.clockHalf();
        }
        else if (this.cycles == 11185.5) {
            this.clockQuarter();
        }
        if (this.is4Step) {
            //4-Step Mode
            if (this.cycles == 14914.5) {
                this.clockQuarter();
                this.clockHalf();
            }
            else if (this.cycles == 14915) {
                if (this.irqEnabled) {
                    this.nes.cpu.apuIRQ = true;
                }
                this.cycles = 0;
            }
        }
        else {
            //5-Step Mode
            if (this.cycles == 18640.5) {
                this.clockQuarter();
                this.clockHalf();
            }
            else if (this.cycles == 18641) {
                this.cycles = 0;
            }
        }
        APU.triangle.step();
        APU.noise.step();
        APU.pulse1.step();
        APU.pulse2.step();
    }
    clockQuarter() {
        APU.noise.clockEnv();
        APU.triangle.clockLinear();
        APU.pulse1.clockEnv();
        APU.pulse2.clockEnv();
    }
    clockHalf() {
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
    constructor(gain) {
        this.gain = gain;
        this.period = 0;
        this.length = 0;
        this.haltLength = false;
        this.enable = false;
        this.targetVol = 0; //In dB
        this.smoothing = 0.005; //Time to exp trans btwn volume, in seconds
        gain.gain.value = 0; //Turn off volume before starting
    }
    clockLength() {
        if (this.haltLength || this.length == 0)
            return;
        --this.length;
    }
}
class PulseChannel extends AudioChannel {
    constructor(osc, gain, isP1 = true) {
        super(gain);
        this.osc = osc;
        this.isP1 = isP1;
        this.envStart = false;
        this.constantVol = false;
        this.sweepEnabled = false;
        this.sweepReload = false;
        this.sweepNeg = false;
        this.sweepMute = false;
        this.sweepPeriod = 0;
        this.sweepDiv = 0;
        this.sweepShift = 0;
        this.v = 0;
        this.currV = 0;
        this.divider = 0;
        this.decayCount = 0;
        this.periodToFreq = 111860.8;
    }
    setPeriod(val) {
        this.period = val;
        if (val < 8)
            return;
        this.osc.frequency.value = (this.periodToFreq + this.period) / this.period;
    }
    setDuty(val) {
        //TODO: Create Pulse Oscillator and set duty
        return;
    }
    clockSweep() {
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
                    if (this.isP1)
                        p--;
                }
                this.setPeriod(this.period + p);
            }
        }
        else {
            this.sweepDiv--;
        }
    }
    clockEnv() {
        if (!this.envStart) {
            //Dec divider
            if (this.divider-- == 0) {
                this.divider = this.v;
                //Clock decayCount
                if (this.decayCount > 0) {
                    this.decayCount--;
                }
                else if (this.haltLength) {
                    this.decayCount = 15;
                }
            }
        }
        else {
            this.envStart = false;
            this.decayCount = 15;
            this.divider = this.v;
        }
    }
    step() {
        if (this.enable && this.length != 0 && !this.sweepMute && this.period >= 8) {
            //Should produce sound
            if (this.constantVol) {
                if (this.currV != this.v) {
                    this.currV = this.v;
                    this.gain.gain.setTargetAtTime(this.v / 15, 0, this.smoothing);
                }
            }
            else {
                if (this.currV != this.decayCount) {
                    this.currV = this.decayCount;
                    this.gain.gain.setTargetAtTime(this.decayCount / 15, 0, this.smoothing);
                }
            }
        }
        else {
            //Should be quiet
            if (this.currV != 0) {
                this.currV = 0;
                this.gain.gain.setTargetAtTime(0, 0, this.smoothing);
            }
        }
    }
    forceCorrectGain() {
        if (this.enable && this.length != 0 && !this.sweepMute && this.period >= 8) {
            //Should produce sound
            this.gain.gain.setTargetAtTime(this.currV / 15, 0, this.smoothing);
        }
        else {
            //Should be quiet
            this.gain.gain.setTargetAtTime(0, 0, this.smoothing);
        }
    }
}
class TriangleChannel extends AudioChannel {
    constructor(osc, gain) {
        super(gain);
        this.osc = osc;
        this.linearCount = 0;
        this.reloadVal = 0;
        this.linearReload = false;
        this.periodToFreq = 55930.4;
    }
    setPeriod(val) {
        this.period = val;
        if (val < 2)
            return;
        this.osc.frequency.value = (this.periodToFreq + this.period) / this.period;
    }
    clockLinear() {
        if (this.linearReload) {
            this.linearCount = this.reloadVal;
        }
        else if (this.linearCount != 0) {
            --this.linearCount;
        }
        if (!this.haltLength)
            this.linearReload = false;
    }
    setGain(val) {
        this.targetVol = val;
        this.gain.gain.setTargetAtTime(val, 0, this.smoothing);
    }
    getGain() {
        return this.targetVol;
    }
    step() {
        //Turn triangle volume on and off
        if (this.enable && this.length != 0 && this.linearCount != 0 && this.period >= 2) {
            //Should be on
            if (this.getGain() != 1) {
                this.setGain(1);
            }
        }
        else {
            //Should be off
            if (this.getGain() != 0) {
                this.setGain(0);
            }
        }
    }
    forceCorrectGain() {
        if (this.enable && this.length != 0 && this.linearCount != 0 && this.period >= 2) {
            //Should be on
            this.setGain(1);
        }
        else {
            //Should be off
            this.setGain(0);
        }
    }
}
class NoiseChannel extends AudioChannel {
    constructor(osc, gain) {
        super(gain);
        this.osc = osc;
        this.envStart = false;
        this.constantVol = false;
        this.v = 0;
        this.currV = 0;
        this.divider = 0;
        this.decayCount = 0;
        this.smoothing = 0.001;
    }
    setPeriod(val) {
        this.period = val;
    }
    clockEnv() {
        if (!this.envStart) {
            //Dec divider
            if (this.divider-- == 0) {
                this.divider = this.v;
                //Clock decayCount
                if (this.decayCount > 0) {
                    this.decayCount--;
                }
                else if (this.haltLength) {
                    this.decayCount = 15;
                }
            }
        }
        else {
            this.envStart = false;
            this.decayCount = 15;
            this.divider = this.v;
        }
    }
    step() {
        if (this.enable && this.length != 0 && this.period >= 8) {
            //Should produce sound
            if (this.constantVol) {
                if (this.currV != this.v) {
                    this.currV = this.v;
                    this.gain.gain.setTargetAtTime(this.v / 15, 0, this.smoothing);
                }
            }
            else {
                if (this.currV != this.decayCount) {
                    this.currV = this.decayCount;
                    this.gain.gain.setTargetAtTime(this.decayCount / 15, 0, this.smoothing);
                }
            }
        }
        else {
            //Should be quiet
            if (this.currV != 0) {
                this.currV = 0;
                this.gain.gain.setTargetAtTime(0, 0, this.smoothing);
            }
        }
    }
    forceCorrectGain() {
        if (this.enable && this.length != 0 && this.period >= 8) {
            //Should produce sound
            this.gain.gain.setTargetAtTime(this.currV / 15, 0, this.smoothing);
        }
        else {
            //Should be quiet
            this.gain.gain.setTargetAtTime(0, 0, this.smoothing);
        }
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
class CPU {
    constructor(nes) {
        this.debug = false; //Output debug info
        //Stop execution when an infinite loop is detected
        this.detectTraps = false;
        this.RES_VECT_LOC = 0xFFFC;
        this.INT_VECT_LOC = 0xFFFE;
        this.NMI_VECT_LOC = 0xFFFA;
        this.mmc3IRQ = false; //Interrupt Request signal line for MMC3
        this.apuIRQ = false; //Interrupt Request for APU frame counter
        this.NMI = false; //Non-Maskable Interrupt signal line
        this.PC = 0; //Program Counter
        this.flags = {
            carry: false,
            zero: false,
            interruptDisable: true,
            decimalMode: false,
            break: false,
            overflow: false,
            negative: false //Result of last op had bit 7 set to 1
        };
        this.nes = nes;
    }
    boot() {
        this.flags.interruptDisable = true;
        this.ACC = 0;
        this.X = 0;
        this.Y = 0;
        this.SP = 0xFD;
        this.nes.write(0x4015, 0);
        this.nes.write(0x4017, 0);
        for (let i = 0; i < 0x10; i++) {
            this.nes.write(0x4000 + i, 0);
        }
        this.PC = this.getResetVector();
    }
    reset() {
        this.SP -= 3;
        this.flags.interruptDisable = true;
        this.nes.write(0x4015, 0);
        this.PC = this.getResetVector();
    }
    getState() {
        let obj = {};
        let ignoreList = ["RES_VECT_LOC", "INT_VECT_LOC", "NMI_VECT_LOC", "nes", "debug", "detectTraps"];
        let keys = Object.keys(this);
        for (let i = 0; i < keys.length; i++) {
            if (ignoreList.includes(keys[i]))
                continue;
            obj[keys[i]] = this[keys[i]];
        }
        return obj;
    }
    loadState(state) {
        let keys = Object.keys(state);
        for (let i = 0; i < keys.length; i++) {
            this[keys[i]] = state[keys[i]];
        }
    }
    step() {
        //Check interrupt lines
        if (this.NMI) {
            this.NMI = false;
            this.handleInterrupt(this.NMI_VECT_LOC);
        }
        else if (!this.flags.interruptDisable && (this.mmc3IRQ || this.apuIRQ)) {
            this.handleInterrupt(this.INT_VECT_LOC);
        }
        let opCode = this.nes.read(this.PC); //Fetch
        let op = opTable[opCode]; //Decode
        if (op === undefined) {
            let e = new Error(`Encountered unknown opCode: [0x${opCode.toString(16).toUpperCase()}] at PC: 0x${this.PC.toString(16).padStart(4, "0").toUpperCase()}`);
            e.name = "Unexpected OpCode";
            throw e;
        }
        if (this.debug) {
            console.log(`Executing ${op.name} at 0x${this.PC.toString(16).padStart(4, "0").toUpperCase()}...`);
        }
        op.execute.bind(this)(); //Execute
        if (this.debug) {
            this.displayState();
            console.log("");
        }
        this.PC += op.bytes;
        if (this.PC > 0xFFFF) {
            this.PC -= 0x10000;
        }
        return op.cycles;
    }
    requestNMInterrupt() {
        this.NMI = true;
    }
    handleInterrupt(resetVectStartAddr, setBRK = false) {
        //Split PC and add each addr byte to stack
        let bytes = splitHex(this.PC);
        this.pushStack(bytes[0]); //MSB
        this.pushStack(bytes[1]); //LSB
        //Store the processor status in the stack
        let statusByte = 0x00;
        //Set each bit accoriding to flags, ignoring the break flag
        statusByte += (this.flags.carry) ? 1 : 0;
        statusByte += (this.flags.zero) ? 2 : 0;
        statusByte += (this.flags.interruptDisable) ? 4 : 0;
        statusByte += (this.flags.decimalMode) ? 8 : 0;
        statusByte += (setBRK) ? 16 : 0;
        statusByte += 32; //This bit always set
        statusByte += (this.flags.overflow) ? 64 : 0;
        statusByte += (this.flags.negative) ? 128 : 0;
        this.pushStack(statusByte);
        this.flags.interruptDisable = true;
        //Set program counter to interrupt vector
        this.PC = combineHex(this.nes.read(resetVectStartAddr + 1), this.nes.read(resetVectStartAddr));
    }
    getResetVector() {
        return combineHex(this.nes.read(this.RES_VECT_LOC + 1), this.nes.read(this.RES_VECT_LOC));
    }
    pushStack(byte) {
        //Write byte to stack
        this.nes.write(combineHex(0x01, this.SP), byte);
        //Decrement stack pointer, wrap if necessary
        this.SP--;
        if (this.SP < 0) {
            this.SP = 0xFF;
        }
    }
    pullStack() {
        this.SP++;
        if (this.SP > 0xFF) {
            this.SP = 0;
        }
        let byte = this.nes.read(combineHex(0x01, this.SP));
        return byte;
    }
    displayState() {
        //Print Registers
        console.log(`[ACC: 0x${this.ACC.toString(16).padStart(2, "0").toUpperCase()} X: 0x${this.X.toString(16).padStart(2, "0").toUpperCase()} Y: 0x${this.Y.toString(16).padStart(2, "0").toUpperCase()} PC: 0x${this.PC.toString(16).padStart(4, "0").toUpperCase()} SP: 0x${this.SP.toString(16).padStart(2, "0").toUpperCase()} ]`);
        //Print flags
        let keys = Object.getOwnPropertyNames(this.flags);
        for (let key of keys) {
            console.log(`${key}: ${this.flags[key]}`);
        }
    }
    nextByte() {
        return this.nes.read(this.PC + 1);
    }
    next2Bytes(flip = true) {
        if (flip) {
            return combineHex(this.nes.read(this.PC + 2), this.nes.read(this.PC + 1));
        }
        else {
            return combineHex(this.nes.read(this.PC + 1), this.nes.read(this.PC + 2));
        }
    }
    updateOverflowFlag(reg, num1, num2) {
        //If the sum of two like signed terms is a diff sign, then the
        //signed result is outside [-128, 127], so set overflow flag
        this.flags.overflow = (num1 < 0x80 && num2 < 0x80 && reg >= 0x80) ||
            (num1 >= 0x80 && num2 >= 0x80 && reg < 0x80);
    }
    updateNegativeFlag(register) {
        this.flags.negative = ((register & 0x80) != 0);
    }
    updateNumStateFlags(register) {
        this.flags.zero = (register === 0x00);
        this.updateNegativeFlag(register);
    }
    getRef(offset = 0) {
        let addr = this.next2Bytes() + offset;
        if (addr > 0xFFFF) {
            addr -= 0x10000;
        }
        if (this.debug) {
            console.log(`Accessing memory at 0x${addr.toString(16).padStart(4, "0").toUpperCase()}...`);
        }
        return addr;
    }
    getZPageRef(offset = 0) {
        let addr = this.nextByte() + offset;
        addr -= (addr > 0xFF) ? 0x100 : 0;
        if (this.debug) {
            console.log(`Accessing memory at 0x${addr.toString(16).padStart(4, "0").toUpperCase()}...`);
        }
        return addr;
    }
    getIndrXRef() {
        let addr = this.getZPageRef(this.X);
        if (addr == 0xFF) {
            return combineHex(this.nes.read(0), this.nes.read(addr));
        }
        else {
            return combineHex(this.nes.read(addr + 1), this.nes.read(addr));
        }
    }
    getIndrYRef() {
        let addr = this.getZPageRef();
        let res;
        if (addr == 0xFF) {
            res = combineHex(this.nes.read(0), this.nes.read(addr)) + this.Y;
        }
        else {
            res = combineHex(this.nes.read(addr + 1), this.nes.read(addr)) + this.Y;
        }
        if (res > 0xFFFF) {
            res -= 0x10000;
        }
        return res;
    }
}
function absXCycles(obj) {
    if (this.X + this.nes.mainMemory[this.PC + 1] > 0xFF) {
        //Page crossed, adj cycle count
        obj.cycles = 5;
    }
    else {
        obj.cycles = 4;
    }
}
function absYCycles(obj) {
    if (this.Y + this.nes.mainMemory[this.PC + 1] > 0xFF) {
        //Page crossed, adj cycle count
        obj.cycles = 5;
    }
    else {
        obj.cycles = 4;
    }
}
function indYCycles(obj) {
    let addr = this.getZPageRef();
    if (this.nes.mainMemory[addr] + this.Y > 0xFF) {
        obj.cycles = 6;
    }
    else {
        obj.cycles = 5;
    }
}
let opTable = {};
opTable[0x00] = {
    name: "BRK",
    bytes: 0,
    cycles: 7,
    execute: function () {
        this.PC += 2;
        this.handleInterrupt(this.INT_VECT_LOC, true);
    }
};
opTable[0xA9] = {
    name: "LDA (imm)",
    bytes: 2,
    cycles: 2,
    execute: function () {
        this.ACC = this.nextByte();
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0xAD] = {
    name: "LDA (abs)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        let addr = this.getRef();
        this.ACC = this.nes.read(addr);
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0xBD] = {
    name: "LDA (abs, X)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        absXCycles.call(this, opTable[0xBD]);
        let addr = this.getRef(this.X);
        this.ACC = this.nes.read(addr);
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0xB9] = {
    name: "LDA (abs, Y)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        absYCycles.call(this, opTable[0xB9]);
        let addr = this.getRef(this.Y);
        this.ACC = this.nes.read(addr);
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0xA5] = {
    name: "LDA (zpg)",
    bytes: 2,
    cycles: 3,
    execute: function () {
        let addr = this.getZPageRef();
        this.ACC = this.nes.read(addr);
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0xB5] = {
    name: "LDA (zpg, X)",
    bytes: 2,
    cycles: 4,
    execute: function () {
        let addr = this.getZPageRef(this.X);
        this.ACC = this.nes.read(addr);
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0xA1] = {
    name: "LDA (ind, X)",
    bytes: 2,
    cycles: 6,
    execute: function () {
        let addr = this.getIndrXRef();
        this.ACC = this.nes.read(addr);
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0xB1] = {
    name: "LDA (ind), Y",
    bytes: 2,
    cycles: 5,
    execute: function () {
        indYCycles.call(this, opTable[0xB1]);
        let addr = this.getIndrYRef();
        this.ACC = this.nes.read(addr);
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0xA2] = {
    name: "LDX (imm)",
    bytes: 2,
    cycles: 2,
    execute: function () {
        this.X = this.nextByte();
        this.updateNumStateFlags(this.X);
    }
};
opTable[0xA6] = {
    name: "LDX (zpg)",
    bytes: 2,
    cycles: 3,
    execute: function () {
        let addr = this.getZPageRef();
        this.X = this.nes.read(addr);
        this.updateNumStateFlags(this.X);
    }
};
opTable[0xB6] = {
    name: "LDX (zpg, Y)",
    bytes: 2,
    cycles: 4,
    execute: function () {
        let addr = this.getZPageRef(this.Y);
        this.X = this.nes.read(addr);
        this.updateNumStateFlags(this.X);
    }
};
opTable[0xAE] = {
    name: "LDX (abs)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        let addr = this.getRef();
        this.X = this.nes.read(addr);
        this.updateNumStateFlags(this.X);
    }
};
opTable[0xBE] = {
    name: "LDX (abs, Y)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        absYCycles.call(this, opTable[0xBE]);
        let addr = this.getRef(this.Y);
        this.X = this.nes.read(addr);
        this.updateNumStateFlags(this.X);
    }
};
opTable[0xA0] = {
    name: "LDY (imm)",
    bytes: 2,
    cycles: 2,
    execute: function () {
        this.Y = this.nextByte();
        this.updateNumStateFlags(this.Y);
    }
};
opTable[0xA4] = {
    name: "LDY (zpg)",
    bytes: 2,
    cycles: 3,
    execute: function () {
        let addr = this.getZPageRef();
        this.Y = this.nes.read(addr);
        this.updateNumStateFlags(this.Y);
    }
};
opTable[0xB4] = {
    name: "LDY (zpg, X)",
    bytes: 2,
    cycles: 4,
    execute: function () {
        let addr = this.getZPageRef(this.X);
        this.Y = this.nes.read(addr);
        this.updateNumStateFlags(this.Y);
    }
};
opTable[0xAC] = {
    name: "LDY (abs)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        let addr = this.getRef();
        this.Y = this.nes.read(addr);
        this.updateNumStateFlags(this.Y);
    }
};
opTable[0xBC] = {
    name: "LDY (abs, X)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        absYCycles.call(this, opTable[0xBC]);
        let addr = this.getRef(this.X);
        this.Y = this.nes.read(addr);
        this.updateNumStateFlags(this.Y);
    }
};
opTable[0x85] = {
    name: "STA (zpg)",
    bytes: 2,
    cycles: 3,
    execute: function () {
        let addr = this.getZPageRef();
        this.nes.write(addr, this.ACC);
    }
};
opTable[0x95] = {
    name: "STA (zpg, X)",
    bytes: 2,
    cycles: 4,
    execute: function () {
        let addr = this.getZPageRef(this.X);
        this.nes.write(addr, this.ACC);
    }
};
opTable[0x8D] = {
    name: "STA (abs)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        let addr = this.getRef();
        this.nes.write(addr, this.ACC);
    }
};
opTable[0x9D] = {
    name: "STA (abs, X)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        let addr = this.getRef(this.X);
        this.nes.write(addr, this.ACC);
    }
};
opTable[0x99] = {
    name: "STA (abs, Y)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        let addr = this.getRef(this.Y);
        this.nes.write(addr, this.ACC);
    }
};
opTable[0x81] = {
    name: "STA (ind, X)",
    bytes: 2,
    cycles: 6,
    execute: function () {
        let addr = this.getIndrXRef();
        this.nes.write(addr, this.ACC);
    }
};
opTable[0x91] = {
    name: "STA (ind), Y",
    bytes: 2,
    cycles: 5,
    execute: function () {
        let addr = this.getIndrYRef();
        this.nes.write(addr, this.ACC);
    }
};
opTable[0x86] = {
    name: "STX (zpg)",
    bytes: 2,
    cycles: 3,
    execute: function () {
        let addr = this.getZPageRef();
        this.nes.write(addr, this.X);
    }
};
opTable[0x96] = {
    name: "STX (zpg, Y)",
    bytes: 2,
    cycles: 4,
    execute: function () {
        let addr = this.getZPageRef(this.Y);
        this.nes.write(addr, this.X);
    }
};
opTable[0x8E] = {
    name: "STX (abs)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        let addr = this.getRef();
        this.nes.write(addr, this.X);
    }
};
opTable[0x84] = {
    name: "STY (zpg)",
    bytes: 2,
    cycles: 3,
    execute: function () {
        let addr = this.getZPageRef();
        this.nes.write(addr, this.Y);
    }
};
opTable[0x94] = {
    name: "STY (zpg, Y)",
    bytes: 2,
    cycles: 4,
    execute: function () {
        let addr = this.getZPageRef(this.X);
        this.nes.write(addr, this.Y);
    }
};
opTable[0x8C] = {
    name: "STY (abs)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        let addr = this.getRef();
        this.nes.write(addr, this.Y);
    }
};
opTable[0xAA] = {
    name: "TAX",
    bytes: 1,
    cycles: 2,
    execute: function () {
        this.X = this.ACC;
        this.updateNumStateFlags(this.X);
    }
};
opTable[0xA8] = {
    name: "TAY",
    bytes: 1,
    cycles: 2,
    execute: function () {
        this.Y = this.ACC;
        this.updateNumStateFlags(this.Y);
    }
};
opTable[0xBA] = {
    name: "TSX",
    bytes: 1,
    cycles: 2,
    execute: function () {
        this.X = this.SP;
        this.updateNumStateFlags(this.X);
    }
};
opTable[0x8A] = {
    name: "TXA",
    bytes: 1,
    cycles: 2,
    execute: function () {
        this.ACC = this.X;
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x9A] = {
    name: "TXS",
    bytes: 1,
    cycles: 2,
    execute: function () {
        this.SP = this.X;
    }
};
opTable[0x98] = {
    name: "TYA",
    bytes: 1,
    cycles: 2,
    execute: function () {
        this.ACC = this.Y;
        this.updateNumStateFlags(this.Y);
    }
};
function ADC(num) {
    let num2 = this.ACC;
    this.ACC += num + this.flags.carry;
    //Wrap ACC and set/clear carry flag
    if (this.ACC > 0xFF) {
        this.flags.carry = true;
        this.ACC -= 0x100;
    }
    else {
        this.flags.carry = false;
    }
    ///Set/clear overflow flag
    this.updateOverflowFlag(this.ACC, num, num2);
    //Set/clear negative + zero flags
    this.updateNumStateFlags(this.ACC);
}
opTable[0x69] = {
    name: "ADC (imm)",
    bytes: 2,
    cycles: 2,
    execute: function () {
        ADC.call(this, this.nextByte());
    }
};
opTable[0x65] = {
    name: "ADC (zpg)",
    bytes: 2,
    cycles: 3,
    execute: function () {
        let addr = this.getZPageRef();
        ADC.call(this, this.nes.read(addr));
    }
};
opTable[0x75] = {
    name: "ADC (zpg, X)",
    bytes: 2,
    cycles: 4,
    execute: function () {
        let addr = this.getZPageRef(this.X);
        ADC.call(this, this.nes.read(addr));
    }
};
opTable[0x6D] = {
    name: "ADC (abs)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        let addr = this.getRef();
        ADC.call(this, this.nes.read(addr));
    }
};
opTable[0x7D] = {
    name: "ADC (abs, X)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        absXCycles.call(this, opTable[0x7D]);
        let addr = this.getRef(this.X);
        ADC.call(this, this.nes.read(addr));
    }
};
opTable[0x79] = {
    name: "ADC (abs, Y)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        absYCycles.call(this, opTable[0x79]);
        let addr = this.getRef(this.Y);
        ADC.call(this, this.nes.read(addr));
    }
};
opTable[0x61] = {
    name: "ADC (ind, X)",
    bytes: 2,
    cycles: 6,
    execute: function () {
        let addr = this.getIndrXRef();
        ADC.call(this, this.nes.read(addr));
    }
};
opTable[0x71] = {
    name: "ADC (ind), Y",
    bytes: 2,
    cycles: 6,
    execute: function () {
        indYCycles.call(this, opTable[0x71]);
        let addr = this.getIndrYRef();
        ADC.call(this, this.nes.read(addr));
    }
};
function SBC(num) {
    let mask = 0xFF;
    ADC.call(this, (num ^ mask));
}
opTable[0xE9] = {
    name: "SBC (imm)",
    bytes: 2,
    cycles: 2,
    execute: function () {
        SBC.call(this, this.nextByte());
    }
};
opTable[0xE5] = {
    name: "SBC (zpg)",
    bytes: 2,
    cycles: 3,
    execute: function () {
        let num = this.nes.read(this.getZPageRef());
        SBC.call(this, num);
    }
};
opTable[0xF5] = {
    name: "SBC (zpg, X)",
    bytes: 2,
    cycles: 4,
    execute: function () {
        let num = this.nes.read(this.getZPageRef(this.X));
        SBC.call(this, num);
    }
};
opTable[0xED] = {
    name: "SBC (abs)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        let num = this.nes.read(this.getRef());
        SBC.call(this, num);
    }
};
opTable[0xFD] = {
    name: "SBC (abs, X)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        absXCycles.call(this, opTable[0xFD]);
        let num = this.nes.read(this.getRef(this.X));
        SBC.call(this, num);
    }
};
opTable[0xF9] = {
    name: "SBC (abs, Y)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        absYCycles.call(this, opTable[0xF9]);
        let num = this.nes.read(this.getRef(this.Y));
        SBC.call(this, num);
    }
};
opTable[0xE1] = {
    name: "SBC (ind, X)",
    bytes: 2,
    cycles: 6,
    execute: function () {
        let num = this.nes.read(this.getIndrXRef());
        SBC.call(this, num);
    }
};
opTable[0xF1] = {
    name: "SBC (ind), Y",
    bytes: 2,
    cycles: 5,
    execute: function () {
        indYCycles.call(this, opTable[0xF1]);
        let num = this.nes.read(this.getIndrYRef());
        SBC.call(this, num);
    }
};
opTable[0xEA] = {
    name: "NOP",
    bytes: 1,
    cycles: 2,
    execute: function () { }
};
opTable[0xE6] = {
    name: "INC (zpg)",
    bytes: 2,
    cycles: 5,
    execute: function () {
        let addr = this.getZPageRef();
        this.nes.write(addr, addWrap(this.nes.read(addr), 1));
        this.updateNumStateFlags(this.nes.read(addr));
    }
};
opTable[0xF6] = {
    name: "INC (zpg, X)",
    bytes: 2,
    cycles: 6,
    execute: function () {
        let addr = this.getZPageRef(this.X);
        this.nes.write(addr, addWrap(this.nes.read(addr), 1));
        this.updateNumStateFlags(this.nes.read(addr));
    }
};
opTable[0xEE] = {
    name: "INC (abs)",
    bytes: 3,
    cycles: 6,
    execute: function () {
        let addr = this.getRef();
        this.nes.write(addr, addWrap(this.nes.read(addr), 1));
        this.updateNumStateFlags(this.nes.read(addr));
    }
};
opTable[0xFE] = {
    name: "INC (abs, X)",
    bytes: 3,
    cycles: 7,
    execute: function () {
        let addr = this.getRef(this.X);
        this.nes.write(addr, addWrap(this.nes.read(addr), 1));
        this.updateNumStateFlags(this.nes.read(addr));
    }
};
opTable[0xE8] = {
    name: "INX",
    bytes: 1,
    cycles: 2,
    execute: function () {
        this.X = addWrap(this.X, 1);
        this.updateNumStateFlags(this.X);
    }
};
opTable[0xC8] = {
    name: "INY",
    bytes: 1,
    cycles: 2,
    execute: function () {
        this.Y = addWrap(this.Y, 1);
        this.updateNumStateFlags(this.Y);
    }
};
opTable[0xC6] = {
    name: "DEC (zpg)",
    bytes: 2,
    cycles: 5,
    execute: function () {
        let addr = this.getZPageRef();
        this.nes.write(addr, addWrap(this.nes.read(addr), -1));
        this.updateNumStateFlags(this.nes.read(addr));
    }
};
opTable[0xD6] = {
    name: "DEC (zpg, X)",
    bytes: 2,
    cycles: 6,
    execute: function () {
        let addr = this.getZPageRef(this.X);
        this.nes.write(addr, addWrap(this.nes.read(addr), -1));
        this.updateNumStateFlags(this.nes.read(addr));
    }
};
opTable[0xCE] = {
    name: "DEC (abs)",
    bytes: 3,
    cycles: 6,
    execute: function () {
        let addr = this.getRef();
        this.nes.write(addr, addWrap(this.nes.read(addr), -1));
        this.updateNumStateFlags(this.nes.read(addr));
    }
};
opTable[0xDE] = {
    name: "DEC (abs, X)",
    bytes: 3,
    cycles: 7,
    execute: function () {
        let addr = this.getRef(this.X);
        this.nes.write(addr, addWrap(this.nes.read(addr), -1));
        this.updateNumStateFlags(this.nes.read(addr));
    }
};
opTable[0xCA] = {
    name: "DEX",
    bytes: 1,
    cycles: 2,
    execute: function () {
        this.X = addWrap(this.X, -1);
        this.updateNumStateFlags(this.X);
    }
};
opTable[0x88] = {
    name: "DEY",
    bytes: 1,
    cycles: 2,
    execute: function () {
        this.Y = addWrap(this.Y, -1);
        this.updateNumStateFlags(this.Y);
    }
};
opTable[0x18] = {
    name: "CLC",
    bytes: 1,
    cycles: 2,
    execute: function () {
        this.flags.carry = false;
    }
};
opTable[0xD8] = {
    name: "CLD",
    bytes: 1,
    cycles: 2,
    execute: function () {
        this.flags.decimalMode = false;
    }
};
opTable[0xB8] = {
    name: "CLV",
    bytes: 1,
    cycles: 2,
    execute: function () {
        this.flags.overflow = false;
    }
};
opTable[0x58] = {
    name: "CLI",
    bytes: 1,
    cycles: 2,
    execute: function () {
        this.flags.interruptDisable = false;
    }
};
opTable[0x38] = {
    name: "SEC",
    bytes: 1,
    cycles: 2,
    execute: function () {
        this.flags.carry = true;
    }
};
opTable[0xF8] = {
    name: "SED",
    bytes: 1,
    cycles: 2,
    execute: function () {
        this.flags.decimalMode = true;
    }
};
opTable[0x78] = {
    name: "SEI",
    bytes: 1,
    cycles: 2,
    execute: function () {
        this.flags.interruptDisable = true;
    }
};
function CMP(num, register) {
    this.flags.zero = (register == num);
    let res = register - num;
    res += (res < 0) ? 0x10000 : 0;
    this.updateNegativeFlag(res);
    this.flags.carry = (register >= num);
}
opTable[0xC9] = {
    name: "CMP (imm)",
    bytes: 2,
    cycles: 2,
    execute: function () {
        CMP.call(this, this.nextByte(), this.ACC);
    }
};
opTable[0xC5] = {
    name: "CMP (zpg)",
    bytes: 2,
    cycles: 3,
    execute: function () {
        CMP.call(this, this.nes.read(this.getZPageRef()), this.ACC);
    }
};
opTable[0xD5] = {
    name: "CMP (zpg, X)",
    bytes: 2,
    cycles: 4,
    execute: function () {
        CMP.call(this, this.nes.read(this.getZPageRef(this.X)), this.ACC);
    }
};
opTable[0xCD] = {
    name: "CMP (abs)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        CMP.call(this, this.nes.read(this.getRef()), this.ACC);
    }
};
opTable[0xDD] = {
    name: "CMP (abs, X)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        absXCycles.call(this, opTable[0xDD]);
        CMP.call(this, this.nes.read(this.getRef(this.X)), this.ACC);
    }
};
opTable[0xD9] = {
    name: "CMP (abs, Y)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        absYCycles.call(this, opTable[0xD9]);
        CMP.call(this, this.nes.read(this.getRef(this.Y)), this.ACC);
    }
};
opTable[0xC1] = {
    name: "CMP (ind, X)",
    bytes: 2,
    cycles: 6,
    execute: function () {
        CMP.call(this, this.nes.read(this.getIndrXRef()), this.ACC);
    }
};
opTable[0xD1] = {
    name: "CMP (ind), Y",
    bytes: 2,
    cycles: 5,
    execute: function () {
        indYCycles.call(this, opTable[0xD1]);
        CMP.call(this, this.nes.read(this.getIndrYRef()), this.ACC);
    }
};
opTable[0xE0] = {
    name: "CPX (imm)",
    bytes: 2,
    cycles: 2,
    execute: function () {
        CMP.call(this, this.nextByte(), this.X);
    }
};
opTable[0xE4] = {
    name: "CPX (zpg)",
    bytes: 2,
    cycles: 3,
    execute: function () {
        CMP.call(this, this.nes.read(this.getZPageRef()), this.X);
    }
};
opTable[0xEC] = {
    name: "CPX (abs)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        CMP.call(this, this.nes.read(this.getRef()), this.X);
    }
};
opTable[0xC0] = {
    name: "CPY (imm)",
    bytes: 2,
    cycles: 2,
    execute: function () {
        CMP.call(this, this.nextByte(), this.Y);
    }
};
opTable[0xC4] = {
    name: "CPY (zpg)",
    bytes: 2,
    cycles: 3,
    execute: function () {
        CMP.call(this, this.nes.read(this.getZPageRef()), this.Y);
    }
};
opTable[0xCC] = {
    name: "CPY (abs)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        CMP.call(this, this.nes.read(this.getRef()), this.Y);
    }
};
opTable[0x29] = {
    name: "AND (imm)",
    bytes: 2,
    cycles: 2,
    execute: function () {
        this.ACC = this.ACC & this.nextByte();
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x25] = {
    name: "AND (zpg)",
    bytes: 2,
    cycles: 3,
    execute: function () {
        this.ACC = this.ACC & this.nes.read(this.getZPageRef());
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x35] = {
    name: "AND (zpg, X)",
    bytes: 2,
    cycles: 4,
    execute: function () {
        this.ACC = this.ACC & this.nes.read(this.getZPageRef(this.X));
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x2D] = {
    name: "AND (abs)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        this.ACC = this.ACC & this.nes.read(this.getRef());
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x3D] = {
    name: "AND (abs, X)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        absXCycles.call(this, opTable[0x3D]);
        this.ACC = this.ACC & this.nes.read(this.getRef(this.X));
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x39] = {
    name: "AND (abs, Y)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        absYCycles.call(this, opTable[0x39]);
        this.ACC = this.ACC & this.nes.read(this.getRef(this.Y));
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x21] = {
    name: "AND (ind, X)",
    bytes: 2,
    cycles: 6,
    execute: function () {
        this.ACC = this.ACC & this.nes.read(this.getIndrXRef());
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x31] = {
    name: "AND (ind), Y",
    bytes: 2,
    cycles: 5,
    execute: function () {
        indYCycles.call(this, opTable[0x31]);
        this.ACC = this.ACC & this.nes.read(this.getIndrYRef());
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x09] = {
    name: "ORA (imm)",
    bytes: 2,
    cycles: 2,
    execute: function () {
        this.ACC = this.ACC | this.nextByte();
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x05] = {
    name: "ORA (zpg)",
    bytes: 2,
    cycles: 3,
    execute: function () {
        this.ACC = this.ACC | this.nes.read(this.getZPageRef());
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x15] = {
    name: "ORA (zpg, X)",
    bytes: 2,
    cycles: 4,
    execute: function () {
        this.ACC = this.ACC | this.nes.read(this.getZPageRef(this.X));
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x0D] = {
    name: "ORA (abs)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        this.ACC = this.ACC | this.nes.read(this.getRef());
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x1D] = {
    name: "ORA (abs, X)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        absXCycles.call(this, opTable[0x1D]);
        this.ACC = this.ACC | this.nes.read(this.getRef(this.X));
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x19] = {
    name: "ORA (abs, Y)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        absYCycles.call(this, opTable[0x19]);
        this.ACC = this.ACC | this.nes.read(this.getRef(this.Y));
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x01] = {
    name: "ORA (ind, X)",
    bytes: 2,
    cycles: 6,
    execute: function () {
        this.ACC = this.ACC | this.nes.read(this.getIndrXRef());
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x11] = {
    name: "ORA (ind), Y",
    bytes: 2,
    cycles: 5,
    execute: function () {
        indYCycles.call(this, opTable[0x11]);
        this.ACC = this.ACC | this.nes.read(this.getIndrYRef());
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x49] = {
    name: "EOR (imm)",
    bytes: 2,
    cycles: 2,
    execute: function () {
        this.ACC = this.ACC ^ this.nextByte();
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x45] = {
    name: "EOR (zpg)",
    bytes: 2,
    cycles: 3,
    execute: function () {
        this.ACC = this.ACC ^ this.nes.read(this.getZPageRef());
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x55] = {
    name: "EOR (zpg, X)",
    bytes: 2,
    cycles: 4,
    execute: function () {
        this.ACC = this.ACC ^ this.nes.read(this.getZPageRef(this.X));
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x4D] = {
    name: "EOR (abs)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        this.ACC = this.ACC ^ this.nes.read(this.getRef());
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x5D] = {
    name: "EOR (abs, X)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        absXCycles.call(this, opTable[0x5D]);
        this.ACC = this.ACC ^ this.nes.read(this.getRef(this.X));
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x59] = {
    name: "EOR (abs, Y)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        absYCycles.call(this, opTable[0x59]);
        this.ACC = this.ACC ^ this.nes.read(this.getRef(this.Y));
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x41] = {
    name: "EOR (ind, X)",
    bytes: 2,
    cycles: 6,
    execute: function () {
        this.ACC = this.ACC ^ this.nes.read(this.getIndrXRef());
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x51] = {
    name: "EOR (ind), Y",
    bytes: 2,
    cycles: 5,
    execute: function () {
        indYCycles.call(this, opTable[0x51]);
        this.ACC = this.ACC ^ this.nes.read(this.getIndrYRef());
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x0A] = {
    name: "ASL",
    bytes: 1,
    cycles: 2,
    execute: function () {
        this.flags.carry = (this.ACC >= 0x80);
        this.ACC = this.ACC << 1;
        this.ACC -= (this.flags.carry) ? 0x100 : 0;
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x06] = {
    name: "ASL (zpg)",
    bytes: 2,
    cycles: 5,
    execute: function () {
        let addr = this.getZPageRef();
        this.flags.carry = (this.nes.read(addr) >= 0x80);
        this.nes.write(addr, this.nes.read(addr) << 1);
        this.nes.write(addr, this.nes.read(addr) - ((this.flags.carry) ? 0x100 : 0));
        this.updateNumStateFlags(this.nes.read(addr));
    }
};
opTable[0x16] = {
    name: "ASL (zpg, X)",
    bytes: 2,
    cycles: 6,
    execute: function () {
        let addr = this.getZPageRef(this.X);
        this.flags.carry = (this.nes.read(addr) >= 0x80);
        this.nes.write(addr, this.nes.read(addr) << 1);
        this.nes.write(addr, this.nes.read(addr) - ((this.flags.carry) ? 0x100 : 0));
        this.updateNumStateFlags(this.nes.read(addr));
    }
};
opTable[0x0E] = {
    name: "ASL (abs)",
    bytes: 3,
    cycles: 6,
    execute: function () {
        let addr = this.getRef();
        this.flags.carry = (this.nes.read(addr) >= 0x80);
        this.nes.write(addr, this.nes.read(addr) << 1);
        this.nes.write(addr, this.nes.read(addr) - ((this.flags.carry) ? 0x100 : 0));
        this.updateNumStateFlags(this.nes.read(addr));
    }
};
opTable[0x1E] = {
    name: "ASL (abs, X)",
    bytes: 3,
    cycles: 7,
    execute: function () {
        let addr = this.getRef(this.X);
        this.flags.carry = (this.nes.read(addr) >= 0x80);
        this.nes.write(addr, this.nes.read(addr) << 1);
        this.nes.write(addr, this.nes.read(addr) - ((this.flags.carry) ? 0x100 : 0));
        this.updateNumStateFlags(this.nes.read(addr));
    }
};
opTable[0x4A] = {
    name: "LSR",
    bytes: 1,
    cycles: 2,
    execute: function () {
        this.flags.carry = (this.ACC % 2 == 1);
        this.ACC = this.ACC >> 1;
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x46] = {
    name: "LSR (zpg)",
    bytes: 2,
    cycles: 5,
    execute: function () {
        let addr = this.getZPageRef();
        this.flags.carry = (this.nes.read(addr) % 2 == 1);
        this.nes.write(addr, this.nes.read(addr) >> 1);
        this.updateNumStateFlags(this.nes.read(addr));
    }
};
opTable[0x56] = {
    name: "LSR (zpg, X)",
    bytes: 2,
    cycles: 6,
    execute: function () {
        let addr = this.getZPageRef(this.X);
        this.flags.carry = (this.nes.read(addr) % 2 == 1);
        this.nes.write(addr, this.nes.read(addr) >> 1);
        this.updateNumStateFlags(this.nes.read(addr));
    }
};
opTable[0x4E] = {
    name: "LSR (abs)",
    bytes: 3,
    cycles: 6,
    execute: function () {
        let addr = this.getRef();
        this.flags.carry = (this.nes.read(addr) % 2 == 1);
        this.nes.write(addr, this.nes.read(addr) >> 1);
        this.updateNumStateFlags(this.nes.read(addr));
    }
};
opTable[0x5E] = {
    name: "LSR (abs, X)",
    bytes: 3,
    cycles: 7,
    execute: function () {
        let addr = this.getRef(this.X);
        this.flags.carry = (this.nes.read(addr) % 2 == 1);
        this.nes.write(addr, this.nes.read(addr) >> 1);
        this.updateNumStateFlags(this.nes.read(addr));
    }
};
opTable[0x24] = {
    name: "BIT (zpg)",
    bytes: 2,
    cycles: 3,
    execute: function () {
        let addr = this.getZPageRef();
        let res = this.ACC & this.nes.read(addr);
        this.flags.zero = (res == 0x00);
        this.updateNegativeFlag(this.nes.read(addr));
        let mask = 1 << 6; //6th bit mask
        this.flags.overflow = ((this.nes.read(addr) & mask) != 0);
    }
};
opTable[0x2C] = {
    name: "BIT (abs)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        let addr = this.getRef();
        let res = this.ACC & this.nes.read(addr);
        this.flags.zero = (res == 0x00);
        this.updateNegativeFlag(this.nes.read(addr));
        let mask = 1 << 6; //6th bit mask
        this.flags.overflow = ((this.nes.read(addr) & mask) != 0);
    }
};
opTable[0x2A] = {
    name: "ROL",
    bytes: 1,
    cycles: 2,
    execute: function () {
        //Store current carry bit for later
        let addBit = this.flags.carry;
        //Move MSB to carry flag
        this.flags.carry = (this.ACC >= 0x80);
        //Shift one place to the left
        this.ACC = this.ACC << 1;
        //Drop MSB
        this.ACC -= (this.flags.carry) ? 0x100 : 0;
        //Make the prev carry bit the LSB
        this.ACC += addBit;
        //Update flags
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x26] = {
    name: "ROL (zpg)",
    bytes: 2,
    cycles: 5,
    execute: function () {
        let addr = this.getZPageRef();
        let addBit = this.flags.carry;
        this.flags.carry = (this.nes.read(addr) >= 0x80);
        this.nes.write(addr, this.nes.read(addr) << 1);
        this.nes.write(addr, this.nes.read(addr) - ((this.flags.carry) ? 0x100 : 0));
        this.nes.write(addr, this.nes.read(addr) + addBit);
        this.updateNumStateFlags(this.nes.read(addr));
    }
};
opTable[0x36] = {
    name: "ROL (zpg, X)",
    bytes: 2,
    cycles: 6,
    execute: function () {
        let addr = this.getZPageRef(this.X);
        let addBit = this.flags.carry;
        this.flags.carry = (this.nes.read(addr) >= 0x80);
        this.nes.write(addr, this.nes.read(addr) << 1);
        this.nes.write(addr, this.nes.read(addr) - ((this.flags.carry) ? 0x100 : 0));
        this.nes.write(addr, this.nes.read(addr) + addBit);
        this.updateNumStateFlags(this.nes.read(addr));
    }
};
opTable[0x2E] = {
    name: "ROL (abs)",
    bytes: 3,
    cycles: 6,
    execute: function () {
        let addr = this.getRef();
        let addBit = this.flags.carry;
        this.flags.carry = (this.nes.read(addr) >= 0x80);
        this.nes.write(addr, this.nes.read(addr) << 1);
        this.nes.write(addr, this.nes.read(addr) - ((this.flags.carry) ? 0x100 : 0));
        this.nes.write(addr, this.nes.read(addr) + addBit);
        this.updateNumStateFlags(this.nes.read(addr));
    }
};
opTable[0x3E] = {
    name: "ROL (abs, X)",
    bytes: 3,
    cycles: 7,
    execute: function () {
        let addr = this.getRef(this.X);
        let addBit = this.flags.carry;
        this.flags.carry = (this.nes.read(addr) >= 0x80);
        this.nes.write(addr, this.nes.read(addr) << 1);
        this.nes.write(addr, this.nes.read(addr) - ((this.flags.carry) ? 0x100 : 0));
        this.nes.write(addr, this.nes.read(addr) + addBit);
        this.updateNumStateFlags(this.nes.read(addr));
    }
};
opTable[0x6A] = {
    name: "ROR",
    bytes: 1,
    cycles: 2,
    execute: function () {
        //Store current carry bit for later
        let addBit = (this.flags.carry) ? 0x80 : 0;
        //Move LSB to carry flag
        this.flags.carry = (this.ACC % 2 == 1);
        //Shift number one place to the right
        this.ACC = this.ACC >> 1;
        //Make the prev carry bit the MSB
        this.ACC += addBit;
        //Update flags
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x66] = {
    name: "ROR (zpg)",
    bytes: 2,
    cycles: 5,
    execute: function () {
        let addr = this.getZPageRef();
        let addBit = (this.flags.carry) ? 0x80 : 0;
        this.flags.carry = (this.nes.read(addr) % 2 == 1);
        this.nes.write(addr, this.nes.read(addr) >> 1);
        this.nes.write(addr, this.nes.read(addr) + addBit);
        this.updateNumStateFlags(this.nes.read(addr));
    }
};
opTable[0x76] = {
    name: "ROR (zpg, X)",
    bytes: 2,
    cycles: 6,
    execute: function () {
        let addr = this.getZPageRef(this.X);
        let addBit = (this.flags.carry) ? 0x80 : 0;
        this.flags.carry = (this.nes.read(addr) % 2 == 1);
        this.nes.write(addr, this.nes.read(addr) >> 1);
        this.nes.write(addr, this.nes.read(addr) + addBit);
        this.updateNumStateFlags(this.nes.read(addr));
    }
};
opTable[0x6E] = {
    name: "ROR (abs)",
    bytes: 3,
    cycles: 6,
    execute: function () {
        let addr = this.getRef();
        let addBit = (this.flags.carry) ? 0x80 : 0;
        this.flags.carry = (this.nes.read(addr) % 2 == 1);
        this.nes.write(addr, this.nes.read(addr) >> 1);
        this.nes.write(addr, this.nes.read(addr) + addBit);
        this.updateNumStateFlags(this.nes.read(addr));
    }
};
opTable[0x7E] = {
    name: "ROR (abs, X)",
    bytes: 3,
    cycles: 7,
    execute: function () {
        let addr = this.getRef(this.X);
        let addBit = (this.flags.carry) ? 0x80 : 0;
        this.flags.carry = (this.nes.read(addr) % 2 == 1);
        this.nes.write(addr, this.nes.read(addr) >> 1);
        this.nes.write(addr, this.nes.read(addr) + addBit);
        this.updateNumStateFlags(this.nes.read(addr));
    }
};
function branch(obj) {
    let dist = this.nextByte();
    dist -= (dist < 0x80) ? 0 : 0x100;
    if (this.debug) {
        console.log(`Branching ${dist} bytes...`);
    }
    if (dist == -2 && this.detectTraps) {
        console.log(`TRAPPED at 0x${this.PC.toString(16).padStart(4, "0").toUpperCase()}`);
        this.flags.break = true;
    }
    if (((this.PC + dist + 2) & 0xFF00) !== ((this.PC + 2) & 0xFF00)) {
        obj.cycles = 4;
    }
    this.PC += dist;
}
opTable[0x90] = {
    name: "BCC",
    bytes: 2,
    cycles: 2,
    execute: function () {
        if (!this.flags.carry) {
            opTable[0x90].cycles = 3;
            branch.call(this, opTable[0x90]);
        }
        else {
            opTable[0x90].cycles = 2;
        }
    }
};
opTable[0xB0] = {
    name: "BCS",
    bytes: 2,
    cycles: 2,
    execute: function () {
        if (this.flags.carry) {
            opTable[0xB0].cycles = 3;
            branch.call(this, opTable[0xB0]);
        }
        else {
            opTable[0xB0].cycles = 2;
        }
    }
};
opTable[0x30] = {
    name: "BMI",
    bytes: 2,
    cycles: 2,
    execute: function () {
        if (this.flags.negative) {
            opTable[0x30].cycles = 3;
            branch.call(this, opTable[0x30]);
        }
        else {
            opTable[0x30].cycles = 2;
        }
    }
};
opTable[0x10] = {
    name: "BPL",
    bytes: 2,
    cycles: 2,
    execute: function () {
        if (!this.flags.negative) {
            opTable[0x10].cycles = 3;
            branch.call(this, opTable[0x10]);
        }
        else {
            opTable[0x10].cycles = 2;
        }
    }
};
opTable[0xF0] = {
    name: "BEQ",
    bytes: 2,
    cycles: 2,
    execute: function () {
        if (this.flags.zero) {
            opTable[0xF0].cycles = 3;
            branch.call(this, opTable[0xF0]);
        }
        else {
            opTable[0xF0].cycles = 2;
        }
    }
};
opTable[0xD0] = {
    name: "BNE",
    bytes: 2,
    cycles: 2,
    execute: function () {
        if (!this.flags.zero) {
            opTable[0xD0].cycles = 3;
            branch.call(this, opTable[0xD0]);
        }
        else {
            opTable[0xD0].cycles = 2;
        }
    }
};
opTable[0x50] = {
    name: "BVC",
    bytes: 2,
    cycles: 2,
    execute: function () {
        if (!this.flags.overflow) {
            opTable[0x50].cycles = 3;
            branch.call(this, opTable[0x50]);
        }
        else {
            opTable[0x50].cycles = 2;
        }
    }
};
opTable[0x70] = {
    name: "BVS",
    bytes: 2,
    cycles: 2,
    execute: function () {
        if (this.flags.overflow) {
            opTable[0x70].cycles = 3;
            branch.call(this, opTable[0x70]);
        }
        else {
            opTable[0x70].cycles = 2;
        }
    }
};
opTable[0x4C] = {
    name: "JMP (abs)",
    bytes: 3,
    cycles: 3,
    execute: function () {
        let addr = this.getRef();
        if (this.debug) {
            console.log(`Jumping to location 0x${addr.toString(16).padStart(4, "0")}...`);
        }
        if (addr == this.PC && this.detectTraps) {
            console.log(`TRAPPED at 0x${this.PC.toString(16).padStart(4, "0").toUpperCase()}`);
            this.flags.break = true;
        }
        this.PC = addr - 3;
    }
};
opTable[0x6C] = {
    name: "JMP (ind)",
    bytes: 3,
    cycles: 5,
    execute: function () {
        let indAddr = this.next2Bytes();
        let addr;
        if ((indAddr & 0xFF) == 0xFF) {
            addr = combineHex(this.nes.read(indAddr - 0xFF), this.nes.read(indAddr));
        }
        else {
            addr = combineHex(this.nes.read(indAddr + 1), this.nes.read(indAddr));
        }
        if (this.debug) {
            console.log(`Jumping to location 0x${addr}...`);
        }
        if (addr == this.PC && this.detectTraps) {
            console.log(`TRAPPED at 0x${this.PC.toString(16).padStart(4, "0").toUpperCase()}`);
            this.flags.break = true;
        }
        this.PC = addr - 3;
    }
};
opTable[0x20] = {
    name: "JSR",
    bytes: 3,
    cycles: 6,
    execute: function () {
        let addr = this.getRef();
        if (this.debug) {
            console.log(`Jumping to subroutine at 0x${addr.toString(16).padStart(4, "0").toUpperCase()}...`);
        }
        //Split PC and add each addr byte to stack
        let bytes = splitHex(this.PC + 2);
        this.pushStack(bytes[0]);
        this.pushStack(bytes[1]);
        this.PC = addr - 3;
    }
};
opTable[0x60] = {
    name: "RTS",
    bytes: 1,
    cycles: 6,
    execute: function () {
        let loByte = this.pullStack();
        let hiByte = this.pullStack();
        let addr = combineHex(hiByte, loByte);
        if (this.debug) {
            console.log(`Return to location 0x${addr.toString(16).padStart(4, "0").toUpperCase()} from subroutine...`);
        }
        this.PC = addr;
    }
};
opTable[0x48] = {
    name: "PHA",
    bytes: 1,
    cycles: 3,
    execute: function () {
        this.pushStack(this.ACC);
    }
};
opTable[0x08] = {
    name: "PHP",
    bytes: 1,
    cycles: 3,
    execute: function () {
        let statusByte = 0x00;
        //Set each bit accoriding to flags
        statusByte += (this.flags.carry) ? 1 : 0;
        statusByte += (this.flags.zero) ? 2 : 0;
        statusByte += (this.flags.interruptDisable) ? 4 : 0;
        statusByte += (this.flags.decimalMode) ? 8 : 0;
        statusByte += 16; //Always set the break bit from software
        statusByte += 32; //This bit always set
        statusByte += (this.flags.overflow) ? 64 : 0;
        statusByte += (this.flags.negative) ? 128 : 0;
        this.pushStack(statusByte);
    }
};
opTable[0x68] = {
    name: "PLA",
    bytes: 1,
    cycles: 4,
    execute: function () {
        this.ACC = this.pullStack();
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x28] = {
    name: "PLP",
    bytes: 1,
    cycles: 4,
    execute: function () {
        let sByte = this.pullStack();
        //Adjust mask and check each indv bit for each flag
        let mask = 1;
        this.flags.carry = ((sByte & mask) != 0);
        mask = 1 << 1;
        this.flags.zero = ((sByte & mask) != 0);
        mask = 1 << 2;
        this.flags.interruptDisable = ((sByte & mask) != 0);
        mask = 1 << 3;
        this.flags.decimalMode = ((sByte & mask) != 0);
        mask = 1 << 6;
        this.flags.overflow = ((sByte & mask) != 0);
        mask = 1 << 7;
        this.flags.negative = ((sByte & mask) != 0);
    }
};
opTable[0x40] = {
    name: "RTI",
    bytes: 1,
    cycles: 6,
    execute: function () {
        //Pull processor flags from stack
        let sByte = this.pullStack();
        //Adjust mask and check each indv bit for each flag
        let mask = 1;
        this.flags.carry = ((sByte & mask) != 0);
        mask = 1 << 1;
        this.flags.zero = ((sByte & mask) != 0);
        mask = 1 << 2;
        this.flags.interruptDisable = ((sByte & mask) != 0);
        mask = 1 << 3;
        this.flags.decimalMode = ((sByte & mask) != 0);
        mask = 1 << 6;
        this.flags.overflow = ((sByte & mask) != 0);
        mask = 1 << 7;
        this.flags.negative = ((sByte & mask) != 0);
        //Pull PC from stack
        let loByte = this.pullStack();
        let hiByte = this.pullStack();
        let addr = combineHex(hiByte, loByte);
        if (this.debug) {
            console.log(`Return to location 0x${addr.toString(16).padStart(4, "0").toUpperCase()} from interrupt...`);
        }
        this.PC = addr - 1;
    }
};
//UNOFFICIAL OPCODES
opTable[0xEB] = {
    name: "SBC (imm, unoffical)",
    bytes: 2,
    cycles: 2,
    execute: function () {
        SBC.call(this, this.nextByte());
    }
};
//NOP
opTable[0x1A] = {
    name: "NOP",
    bytes: 1,
    cycles: 2,
    execute: function () { }
};
opTable[0x3A] = {
    name: "NOP",
    bytes: 1,
    cycles: 2,
    execute: function () { }
};
opTable[0x5A] = {
    name: "NOP",
    bytes: 1,
    cycles: 2,
    execute: function () { }
};
opTable[0x7A] = {
    name: "NOP",
    bytes: 1,
    cycles: 2,
    execute: function () { }
};
opTable[0xDA] = {
    name: "NOP",
    bytes: 1,
    cycles: 2,
    execute: function () { }
};
opTable[0xFA] = {
    name: "NOP",
    bytes: 1,
    cycles: 2,
    execute: function () { }
};
opTable[0x04] = {
    name: "DOP",
    bytes: 2,
    cycles: 3,
    execute: function () { }
};
opTable[0x14] = {
    name: "DOP",
    bytes: 2,
    cycles: 4,
    execute: function () { }
};
opTable[0x34] = {
    name: "DOP",
    bytes: 2,
    cycles: 4,
    execute: function () { }
};
opTable[0x44] = {
    name: "DOP",
    bytes: 2,
    cycles: 3,
    execute: function () { }
};
opTable[0x54] = {
    name: "DOP",
    bytes: 2,
    cycles: 4,
    execute: function () { }
};
opTable[0x64] = {
    name: "DOP",
    bytes: 2,
    cycles: 3,
    execute: function () { }
};
opTable[0x74] = {
    name: "DOP",
    bytes: 2,
    cycles: 4,
    execute: function () { }
};
opTable[0x80] = {
    name: "DOP",
    bytes: 2,
    cycles: 2,
    execute: function () { }
};
opTable[0x82] = {
    name: "DOP",
    bytes: 2,
    cycles: 2,
    execute: function () { }
};
opTable[0x89] = {
    name: "DOP",
    bytes: 2,
    cycles: 2,
    execute: function () { }
};
opTable[0xC2] = {
    name: "DOP",
    bytes: 2,
    cycles: 2,
    execute: function () { }
};
opTable[0xD4] = {
    name: "DOP",
    bytes: 2,
    cycles: 4,
    execute: function () { }
};
opTable[0xE2] = {
    name: "DOP",
    bytes: 2,
    cycles: 2,
    execute: function () { }
};
opTable[0xF4] = {
    name: "DOP",
    bytes: 2,
    cycles: 4,
    execute: function () { }
};
opTable[0x0C] = {
    name: "TOP",
    bytes: 3,
    cycles: 4,
    execute: function () { }
};
opTable[0x1C] = {
    name: "TOP",
    bytes: 3,
    cycles: 4,
    execute: function () {
        absXCycles.call(this, opTable[0x1C]);
    }
};
opTable[0x3C] = {
    name: "TOP",
    bytes: 3,
    cycles: 4,
    execute: function () {
        absXCycles.call(this, opTable[0x3C]);
    }
};
opTable[0x5C] = {
    name: "TOP",
    bytes: 3,
    cycles: 4,
    execute: function () {
        absXCycles.call(this, opTable[0x5C]);
    }
};
opTable[0x7C] = {
    name: "TOP",
    bytes: 3,
    cycles: 4,
    execute: function () {
        absXCycles.call(this, opTable[0x7C]);
    }
};
opTable[0xDC] = {
    name: "TOP",
    bytes: 3,
    cycles: 4,
    execute: function () {
        absXCycles.call(this, opTable[0xDC]);
    }
};
opTable[0xFC] = {
    name: "TOP",
    bytes: 3,
    cycles: 4,
    execute: function () {
        absXCycles.call(this, opTable[0xFC]);
    }
};
//LAX, Load ACC and X with memory
opTable[0xA3] = {
    name: "LAX (ind, X)",
    bytes: 2,
    cycles: 6,
    execute: function () {
        let addr = this.getIndrXRef();
        this.X = this.nes.read(addr);
        this.ACC = this.nes.read(addr);
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0xB3] = {
    name: "LAX (ind), Y",
    bytes: 2,
    cycles: 5,
    execute: function () {
        indYCycles.call(this, opTable[0xB3]);
        let addr = this.getIndrYRef();
        this.X = this.nes.read(addr);
        this.ACC = this.nes.read(addr);
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0xA7] = {
    name: "LAX (zpg)",
    bytes: 2,
    cycles: 3,
    execute: function () {
        let addr = this.getZPageRef();
        this.X = this.nes.read(addr);
        this.ACC = this.nes.read(addr);
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0xB7] = {
    name: "LAX (zpg, Y)",
    bytes: 2,
    cycles: 4,
    execute: function () {
        let addr = this.getZPageRef(this.Y);
        this.X = this.nes.read(addr);
        this.ACC = this.nes.read(addr);
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0xAF] = {
    name: "LAX (abs)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        let addr = this.getRef();
        this.X = this.nes.read(addr);
        this.ACC = this.nes.read(addr);
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0xBF] = {
    name: "LAX (abs, Y)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        absYCycles.call(this, opTable[0xBF]);
        let addr = this.getRef(this.Y);
        this.X = this.nes.read(addr);
        this.ACC = this.nes.read(addr);
        this.updateNumStateFlags(this.ACC);
    }
};
//AND X with ACC and store result in memory
opTable[0x87] = {
    name: "SAX (zpg)",
    bytes: 2,
    cycles: 3,
    execute: function () {
        let addr = this.getZPageRef();
        this.nes.write(addr, this.ACC & this.X);
    }
};
opTable[0x97] = {
    name: "SAX (zpg, Y)",
    bytes: 2,
    cycles: 4,
    execute: function () {
        let addr = this.getZPageRef(this.Y);
        this.nes.write(addr, this.ACC & this.X);
    }
};
opTable[0x83] = {
    name: "SAX (ind, X)",
    bytes: 2,
    cycles: 6,
    execute: function () {
        let addr = this.getIndrXRef();
        this.nes.write(addr, this.ACC & this.X);
    }
};
opTable[0x8F] = {
    name: "SAX (abs)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        let addr = this.getRef();
        this.nes.write(addr, this.ACC & this.X);
    }
};
//DCP
//Subtract 1 from memory content, then CMP with ACC
function DCP(addr) {
    this.nes.mainMemory[addr] = this.nes.mainMemory[addr] - 1;
    let flipBits = this.nes.mainMemory[addr] ^ 0xFF;
    if (flipBits == 0)
        flipBits++;
    let res = flipBits + this.ACC;
    //Wrap res and set/clear carry flag
    if (res > 0xFF) {
        this.flags.carry = true;
        res -= 0x100;
    }
    else {
        this.flags.carry = false;
    }
    //Set/clear negative + zero flags
    this.updateNumStateFlags(res);
}
opTable[0xC7] = {
    name: "DCP (zpg)",
    bytes: 2,
    cycles: 5,
    execute: function () {
        let addr = this.getZPageRef();
        DCP.call(this, addr);
    }
};
opTable[0xD7] = {
    name: "DCP (zpg, X)",
    bytes: 2,
    cycles: 6,
    execute: function () {
        let addr = this.getZPageRef(this.X);
        DCP.call(this, addr);
    }
};
opTable[0xCF] = {
    name: "DCP (abs)",
    bytes: 3,
    cycles: 6,
    execute: function () {
        let addr = this.getRef();
        DCP.call(this, addr);
    }
};
opTable[0xDF] = {
    name: "DCP (abs, X)",
    bytes: 3,
    cycles: 7,
    execute: function () {
        let addr = this.getRef(this.X);
        DCP.call(this, addr);
    }
};
opTable[0xDB] = {
    name: "DCP (abs, Y)",
    bytes: 3,
    cycles: 7,
    execute: function () {
        let addr = this.getRef(this.Y);
        DCP.call(this, addr);
    }
};
opTable[0xC3] = {
    name: "DCP (ind, X)",
    bytes: 2,
    cycles: 8,
    execute: function () {
        let addr = this.getIndrXRef();
        DCP.call(this, addr);
    }
};
opTable[0xD3] = {
    name: "DCP (ind), Y",
    bytes: 2,
    cycles: 8,
    execute: function () {
        let addr = this.getIndrYRef();
        DCP.call(this, addr);
    }
};
//ISC
//Increase memory content by 1, then SBC from the ACC
opTable[0xE7] = {
    name: "ISC (zpg)",
    bytes: 2,
    cycles: 5,
    execute: function () {
        let addr = this.getZPageRef();
        this.nes.write(addr, this.nes.read(addr) + 1);
        SBC.call(this, this.nes.read(addr));
    }
};
opTable[0xF7] = {
    name: "ISC (zpg, X)",
    bytes: 2,
    cycles: 6,
    execute: function () {
        let addr = this.getZPageRef(this.X);
        this.nes.write(addr, this.nes.read(addr) + 1);
        SBC.call(this, this.nes.read(addr));
    }
};
opTable[0xEF] = {
    name: "ISC (abs)",
    bytes: 3,
    cycles: 6,
    execute: function () {
        let addr = this.getRef();
        this.nes.write(addr, this.nes.read(addr) + 1);
        SBC.call(this, this.nes.read(addr));
    }
};
opTable[0xFF] = {
    name: "ISC (abs, X)",
    bytes: 3,
    cycles: 7,
    execute: function () {
        let addr = this.getRef(this.X);
        this.nes.write(addr, this.nes.read(addr) + 1);
        SBC.call(this, this.nes.read(addr));
    }
};
opTable[0xFB] = {
    name: "ISC (abs, Y)",
    bytes: 3,
    cycles: 7,
    execute: function () {
        let addr = this.getRef(this.Y);
        this.nes.write(addr, this.nes.read(addr) + 1);
        SBC.call(this, this.nes.read(addr));
    }
};
opTable[0xE3] = {
    name: "ISC (ind, X)",
    bytes: 2,
    cycles: 8,
    execute: function () {
        let addr = this.getIndrXRef();
        this.nes.write(addr, this.nes.read(addr) + 1);
        SBC.call(this, this.nes.read(addr));
    }
};
opTable[0xF3] = {
    name: "ISC (abs)",
    bytes: 2,
    cycles: 8,
    execute: function () {
        let addr = this.getIndrYRef();
        this.nes.write(addr, this.nes.read(addr) + 1);
        SBC.call(this, this.nes.read(addr));
    }
};
//SLO
//Shift memory content 1 bit left, then OR with ACC
opTable[0x07] = {
    name: "SLO (zpg)",
    bytes: 2,
    cycles: 5,
    execute: function () {
        let addr = this.getZPageRef();
        this.flags.carry = (this.nes.read(addr) >= 0x80);
        this.nes.write(addr, this.nes.read(addr) << 1);
        this.nes.write(addr, this.nes.read(addr) - ((this.flags.carry) ? 0x100 : 0));
        this.ACC = this.ACC | this.nes.read(addr);
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x17] = {
    name: "SLO (zpg, X)",
    bytes: 2,
    cycles: 6,
    execute: function () {
        let addr = this.getZPageRef(this.X);
        this.flags.carry = (this.nes.read(addr) >= 0x80);
        this.nes.write(addr, this.nes.read(addr) << 1);
        this.nes.write(addr, this.nes.read(addr) - ((this.flags.carry) ? 0x100 : 0));
        this.ACC = this.ACC | this.nes.read(addr);
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x0F] = {
    name: "SLO (abs)",
    bytes: 3,
    cycles: 6,
    execute: function () {
        let addr = this.getRef();
        this.flags.carry = (this.nes.read(addr) >= 0x80);
        this.nes.write(addr, this.nes.read(addr) << 1);
        this.nes.write(addr, this.nes.read(addr) - ((this.flags.carry) ? 0x100 : 0));
        this.ACC = this.ACC | this.nes.read(addr);
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x1F] = {
    name: "SLO (abs, X)",
    bytes: 3,
    cycles: 7,
    execute: function () {
        let addr = this.getRef(this.X);
        this.flags.carry = (this.nes.read(addr) >= 0x80);
        this.nes.write(addr, this.nes.read(addr) << 1);
        this.nes.write(addr, this.nes.read(addr) - ((this.flags.carry) ? 0x100 : 0));
        this.ACC = this.ACC | this.nes.read(addr);
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x1B] = {
    name: "SLO (abs, Y)",
    bytes: 3,
    cycles: 7,
    execute: function () {
        let addr = this.getRef(this.Y);
        this.flags.carry = (this.nes.read(addr) >= 0x80);
        this.nes.write(addr, this.nes.read(addr) << 1);
        this.nes.write(addr, this.nes.read(addr) - ((this.flags.carry) ? 0x100 : 0));
        this.ACC = this.ACC | this.nes.read(addr);
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x03] = {
    name: "SLO (ind, Y)",
    bytes: 2,
    cycles: 8,
    execute: function () {
        let addr = this.getIndrXRef();
        this.flags.carry = (this.nes.read(addr) >= 0x80);
        this.nes.write(addr, this.nes.read(addr) << 1);
        this.nes.write(addr, this.nes.read(addr) - ((this.flags.carry) ? 0x100 : 0));
        this.ACC = this.ACC | this.nes.read(addr);
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x13] = {
    name: "SLO (ind), Y",
    bytes: 2,
    cycles: 8,
    execute: function () {
        let addr = this.getIndrYRef();
        this.flags.carry = (this.nes.read(addr) >= 0x80);
        this.nes.write(addr, this.nes.read(addr) << 1);
        this.nes.write(addr, this.nes.read(addr) - ((this.flags.carry) ? 0x100 : 0));
        this.ACC = this.ACC | this.nes.read(addr);
        this.updateNumStateFlags(this.ACC);
    }
};
//RLA
//Rotate one bit left in memory, AND result with ACC
opTable[0x27] = {
    name: "RLA (zpg)",
    bytes: 2,
    cycles: 5,
    execute: function () {
        let addr = this.getZPageRef();
        let addBit = this.flags.carry;
        this.flags.carry = (this.nes.read(addr) >= 0x80);
        this.nes.write(addr, this.nes.read(addr) << 1);
        this.nes.write(addr, this.nes.read(addr) - ((this.flags.carry) ? 0x100 : 0));
        this.nes.write(addr, this.nes.read(addr) + addBit);
        this.ACC = this.ACC & this.nes.read(addr);
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x37] = {
    name: "RLA (zpg, X)",
    bytes: 2,
    cycles: 6,
    execute: function () {
        let addr = this.getZPageRef(this.X);
        let addBit = this.flags.carry;
        this.flags.carry = (this.nes.read(addr) >= 0x80);
        this.nes.write(addr, this.nes.read(addr) << 1);
        this.nes.write(addr, this.nes.read(addr) - ((this.flags.carry) ? 0x100 : 0));
        this.nes.write(addr, this.nes.read(addr) + addBit);
        this.ACC = this.ACC & this.nes.read(addr);
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x2F] = {
    name: "RLA (abs)",
    bytes: 3,
    cycles: 7,
    execute: function () {
        let addr = this.getRef();
        let addBit = this.flags.carry;
        this.flags.carry = (this.nes.read(addr) >= 0x80);
        this.nes.write(addr, this.nes.read(addr) << 1);
        this.nes.write(addr, this.nes.read(addr) - ((this.flags.carry) ? 0x100 : 0));
        this.nes.write(addr, this.nes.read(addr) + addBit);
        this.ACC = this.ACC & this.nes.read(addr);
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x3F] = {
    name: "RLA (abs, X)",
    bytes: 3,
    cycles: 7,
    execute: function () {
        let addr = this.getRef(this.X);
        let addBit = this.flags.carry;
        this.flags.carry = (this.nes.read(addr) >= 0x80);
        this.nes.write(addr, this.nes.read(addr) << 1);
        this.nes.write(addr, this.nes.read(addr) - ((this.flags.carry) ? 0x100 : 0));
        this.nes.write(addr, this.nes.read(addr) + addBit);
        this.ACC = this.ACC & this.nes.read(addr);
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x3B] = {
    name: "RLA (abs, Y)",
    bytes: 3,
    cycles: 7,
    execute: function () {
        let addr = this.getRef(this.Y);
        let addBit = this.flags.carry;
        this.flags.carry = (this.nes.read(addr) >= 0x80);
        this.nes.write(addr, this.nes.read(addr) << 1);
        this.nes.write(addr, this.nes.read(addr) - ((this.flags.carry) ? 0x100 : 0));
        this.nes.write(addr, this.nes.read(addr) + addBit);
        this.ACC = this.ACC & this.nes.read(addr);
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x23] = {
    name: "RLA (ind, X)",
    bytes: 2,
    cycles: 8,
    execute: function () {
        let addr = this.getIndrXRef();
        let addBit = this.flags.carry;
        this.flags.carry = (this.nes.read(addr) >= 0x80);
        this.nes.write(addr, this.nes.read(addr) << 1);
        this.nes.write(addr, this.nes.read(addr) - ((this.flags.carry) ? 0x100 : 0));
        this.nes.write(addr, this.nes.read(addr) + addBit);
        this.ACC = this.ACC & this.nes.read(addr);
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x33] = {
    name: "RLA (ind), Y",
    bytes: 2,
    cycles: 8,
    execute: function () {
        let addr = this.getIndrYRef();
        let addBit = this.flags.carry;
        this.flags.carry = (this.nes.read(addr) >= 0x80);
        this.nes.write(addr, this.nes.read(addr) << 1);
        this.nes.write(addr, this.nes.read(addr) - ((this.flags.carry) ? 0x100 : 0));
        this.nes.write(addr, this.nes.read(addr) + addBit);
        this.ACC = this.ACC & this.nes.read(addr);
        this.updateNumStateFlags(this.ACC);
    }
};
//SRE
//Shift memory 1 bit right, then EOR with ACC
opTable[0x47] = {
    name: "SRE (zpg)",
    bytes: 2,
    cycles: 5,
    execute: function () {
        let addr = this.getZPageRef();
        this.flags.carry = (this.nes.read(addr) % 2 == 1);
        this.nes.write(addr, this.nes.read(addr) >> 1);
        this.ACC = this.ACC ^ this.nes.read(addr);
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x57] = {
    name: "SRE (zpg, X)",
    bytes: 2,
    cycles: 6,
    execute: function () {
        let addr = this.getZPageRef(this.X);
        this.flags.carry = (this.nes.read(addr) % 2 == 1);
        this.nes.write(addr, this.nes.read(addr) >> 1);
        this.ACC = this.ACC ^ this.nes.read(addr);
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x4F] = {
    name: "SRE (abs)",
    bytes: 3,
    cycles: 6,
    execute: function () {
        let addr = this.getRef();
        this.flags.carry = (this.nes.read(addr) % 2 == 1);
        this.nes.write(addr, this.nes.read(addr) >> 1);
        this.ACC = this.ACC ^ this.nes.read(addr);
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x5F] = {
    name: "SRE (abs, X)",
    bytes: 3,
    cycles: 7,
    execute: function () {
        let addr = this.getRef(this.X);
        this.flags.carry = (this.nes.read(addr) % 2 == 1);
        this.nes.write(addr, this.nes.read(addr) >> 1);
        this.ACC = this.ACC ^ this.nes.read(addr);
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x5B] = {
    name: "SRE (abs, Y)",
    bytes: 3,
    cycles: 7,
    execute: function () {
        let addr = this.getRef(this.Y);
        this.flags.carry = (this.nes.read(addr) % 2 == 1);
        this.nes.write(addr, this.nes.read(addr) >> 1);
        this.ACC = this.ACC ^ this.nes.read(addr);
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x43] = {
    name: "SRE (ind, X)",
    bytes: 2,
    cycles: 8,
    execute: function () {
        let addr = this.getIndrXRef();
        this.flags.carry = (this.nes.read(addr) % 2 == 1);
        this.nes.write(addr, this.nes.read(addr) >> 1);
        this.ACC = this.ACC ^ this.nes.read(addr);
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x53] = {
    name: "SRE (ind), X",
    bytes: 2,
    cycles: 8,
    execute: function () {
        let addr = this.getIndrYRef();
        this.flags.carry = (this.nes.read(addr) % 2 == 1);
        this.nes.write(addr, this.nes.read(addr) >> 1);
        this.ACC = this.ACC ^ this.nes.read(addr);
        this.updateNumStateFlags(this.ACC);
    }
};
//RRA
//Rotate memory 1 bit right, then ADC with ACC
opTable[0x67] = {
    name: "RRA (zpg)",
    bytes: 2,
    cycles: 5,
    execute: function () {
        let addr = this.getZPageRef();
        let addBit = (this.flags.carry) ? 0x80 : 0;
        this.flags.carry = (this.nes.read(addr) % 2 == 1);
        this.nes.write(addr, this.nes.read(addr) >> 1);
        this.nes.write(addr, this.nes.read(addr) + addBit);
        ADC.call(this, this.nes.read(addr));
    }
};
opTable[0x77] = {
    name: "RRA (zpg, X)",
    bytes: 2,
    cycles: 6,
    execute: function () {
        let addr = this.getZPageRef(this.X);
        let addBit = (this.flags.carry) ? 0x80 : 0;
        this.flags.carry = (this.nes.read(addr) % 2 == 1);
        this.nes.write(addr, this.nes.read(addr) >> 1);
        this.nes.write(addr, this.nes.read(addr) + addBit);
        ADC.call(this, this.nes.read(addr));
    }
};
opTable[0x6F] = {
    name: "RRA (abs)",
    bytes: 3,
    cycles: 6,
    execute: function () {
        let addr = this.getRef();
        let addBit = (this.flags.carry) ? 0x80 : 0;
        this.flags.carry = (this.nes.read(addr) % 2 == 1);
        this.nes.write(addr, this.nes.read(addr) >> 1);
        this.nes.write(addr, this.nes.read(addr) + addBit);
        ADC.call(this, this.nes.read(addr));
    }
};
opTable[0x7F] = {
    name: "RRA (abs, X)",
    bytes: 3,
    cycles: 7,
    execute: function () {
        let addr = this.getRef(this.X);
        let addBit = (this.flags.carry) ? 0x80 : 0;
        this.flags.carry = (this.nes.read(addr) % 2 == 1);
        this.nes.write(addr, this.nes.read(addr) >> 1);
        this.nes.write(addr, this.nes.read(addr) + addBit);
        ADC.call(this, this.nes.read(addr));
    }
};
opTable[0x7B] = {
    name: "RRA (abs, Y)",
    bytes: 3,
    cycles: 7,
    execute: function () {
        let addr = this.getRef(this.Y);
        let addBit = (this.flags.carry) ? 0x80 : 0;
        this.flags.carry = (this.nes.read(addr) % 2 == 1);
        this.nes.write(addr, this.nes.read(addr) >> 1);
        this.nes.write(addr, this.nes.read(addr) + addBit);
        ADC.call(this, this.nes.read(addr));
    }
};
opTable[0x63] = {
    name: "RRA (ind, X)",
    bytes: 2,
    cycles: 8,
    execute: function () {
        let addr = this.getIndrXRef();
        let addBit = (this.flags.carry) ? 0x80 : 0;
        this.flags.carry = (this.nes.read(addr) % 2 == 1);
        this.nes.write(addr, this.nes.read(addr) >> 1);
        this.nes.write(addr, this.nes.read(addr) + addBit);
        ADC.call(this, this.nes.read(addr));
    }
};
opTable[0x73] = {
    name: "RRA (ind), Y",
    bytes: 2,
    cycles: 8,
    execute: function () {
        let addr = this.getIndrYRef();
        let addBit = (this.flags.carry) ? 0x80 : 0;
        this.flags.carry = (this.nes.read(addr) % 2 == 1);
        this.nes.write(addr, this.nes.read(addr) >> 1);
        this.nes.write(addr, this.nes.read(addr) + addBit);
        ADC.call(this, this.nes.read(addr));
    }
};
//LAR
//AND memory w/ SP, store result in ACC, X, and SP
opTable[0xBB] = {
    name: "LAR (abs, Y)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        absYCycles.call(this, opTable[0xBB]);
        let addr = this.getRef(this.Y);
        this.SP = this.SP & this.nes.read(addr);
        this.X = this.SP;
        this.ACC = this.X;
        this.updateNumStateFlags(this.ACC);
    }
};
//ATX
//AND byte with ACC, transfer ACC to X
opTable[0xAB] = {
    name: "ATX (imm)",
    bytes: 2,
    cycles: 2,
    execute: function () {
        this.ACC = this.ACC & this.nextByte();
        this.X = this.ACC;
        this.updateNumStateFlags(this.ACC);
    }
};
//ANC
//AND ACC with imm val, then move bit 7 of ACC to carry
opTable[0x2B] = {
    name: "ANC (imm)",
    bytes: 2,
    cycles: 2,
    execute: function () {
        this.ACC = this.ACC & this.nextByte();
        this.updateNumStateFlags(this.ACC);
        this.flags.carry = (this.ACC & (1 << 7)) != 0;
    }
};
opTable[0x0B] = {
    name: "ANC (imm)",
    bytes: 2,
    cycles: 2,
    execute: function () {
        this.ACC = this.ACC & this.nextByte();
        this.updateNumStateFlags(this.ACC);
        this.flags.carry = (this.ACC & (1 << 7)) != 0;
    }
};
//ALR
//AND ACC with imm val, then LSR the result
opTable[0x4B] = {
    name: "ALR (imm)",
    bytes: 2,
    cycles: 2,
    execute: function () {
        this.ACC = this.ACC & this.nextByte();
        this.flags.carry = (this.ACC % 2 == 1);
        this.ACC = this.ACC >> 1;
        this.updateNumStateFlags(this.ACC);
    }
};
//ARR
//AND ACC with imm val, then ROR the result
opTable[0x6B] = {
    name: "ARR (imm)",
    bytes: 2,
    cycles: 2,
    execute: function () {
        this.ACC = this.ACC & this.nextByte();
        let addBit = (this.flags.carry) ? 0x80 : 0;
        this.flags.carry = (this.ACC % 2 == 1);
        this.ACC = this.ACC >> 1;
        this.ACC += addBit;
        this.updateNumStateFlags(this.ACC);
    }
};
//SAX
//ANDs the contents of the A and X registers, subtracts an immediate value,
//then stores the result in X.
opTable[0xCB] = {
    name: "AXS (imm)",
    bytes: 2,
    cycles: 2,
    execute: function () {
        let x = this.ACC & this.X;
        let num = this.nextByte();
        this.flags.zero = (x == num);
        let res = x - num;
        res += (res < 0) ? 0x10000 : 0;
        this.updateNegativeFlag(res);
        this.flags.carry = (x >= num);
        this.X = res;
    }
};
AudioContext.prototype.createNoiseSource = function () {
    let bufferSize = 2 * this.sampleRate;
    let buffer = this.createBuffer(1, bufferSize, this.sampleRate);
    let output = buffer.getChannelData(0);
    for (var i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
    }
    let node = this.createBufferSource();
    node.buffer = buffer;
    node.loop = true;
    return node;
};
function combineHex(hiByte, lowByte) {
    return (hiByte << 8) | (lowByte);
}
function splitHex(hex) {
    let str = hex.toString(16).padStart(4, "0");
    let hiByte = parseInt(str.substr(0, 2), 16);
    let loByte = parseInt(str.substr(2), 16);
    return [hiByte, loByte];
}
function addWrap(reg, add) {
    reg = reg + add;
    if (reg > 0xFF) {
        reg = 0x00;
    }
    if (reg < 0x00) {
        reg = 0xFF;
    }
    return reg;
}
function insertInto(addr, byte, i, j1, j2) {
    let mask = 0xFFFF;
    mask ^= (Math.pow(2, (j1 - j2)) - 1) << (i - (j1 - j2));
    addr &= mask; //Clear relevant bits
    //Slice/Shift byte
    byte &= (Math.pow(2, (j1 - j2)) - 1) << j2;
    byte >>= j2;
    byte <<= (i - (j1 - j2));
    return addr | byte;
}
function deepCopyObj(obj) {
    return JSON.parse(JSON.stringify(obj));
}
function updateVol(val) {
    APU.masterVol = Math.pow(val, 2);
    APU.masterGain.gain.setTargetAtTime(Math.pow(val, 2), 0, 0.001);
}
//Returns if browser is compatible or not
function checkComp() {
    let e = false;
    if (!Modernizr.canvas) {
        e = true;
        console.log("Canvas not supported.");
    }
    if (!Modernizr.json) {
        e = true;
        console.log("JSON not supported.");
    }
    if (!Modernizr.requestanimationframe) {
        e = true;
        console.log("requestAnimationFrame not supported.");
    }
    if (!Modernizr.typedarrays) {
        e = true;
        console.log("Typed Arrays not supported.");
    }
    if (!Modernizr.webaudio) {
        e = true;
        console.log("Web Audio API not supported.");
    }
    if (!Modernizr.localstorage) {
        e = true;
        console.log("Local Storage not supported.");
    }
    if (!Modernizr.sessionstorage) {
        e = true;
        console.log("Session Storage not supported.");
    }
    if (navigator.appVersion.includes("Edge")) {
        e = true;
        console.log("Microsoft Edge not supported.");
    }
    if (e) {
        $("#errorOverlay").css("display", "block");
        $("body").css("overflow", "hidden");
    }
    return !e;
}
class Input {
    constructor() {
        this.defaultBind = {
            p1: {
                a: { code: 75, name: "K" },
                b: { code: 74, name: "J" },
                select: { code: 17, name: "Control" },
                start: { code: 13, name: "Enter" },
                up: { code: 87, name: "W" },
                down: { code: 83, name: "S" },
                left: { code: 65, name: "A" },
                right: { code: 68, name: "D" },
            },
            p2: {
                a: { code: 78, name: "N" },
                b: { code: 77, name: "M" },
                select: { code: 17, name: "Control" },
                start: { code: 13, name: "Enter" },
                up: { code: 38, name: "ArrowUp" },
                down: { code: 40, name: "ArrowDown" },
                left: { code: 37, name: "ArrowLeft" },
                right: { code: 39, name: "ArrowRight" },
            }
        };
        this.bindings = (localStorage.getItem("bindings") == null) ?
            deepCopyObj(this.defaultBind) : JSON.parse(localStorage.getItem("bindings"));
        this.p1 = {
            buttons: {
                a: false,
                b: false,
                select: false,
                start: false,
                up: false,
                down: false,
                left: false,
                right: false
            },
            strobe: false,
            shiftReg: []
        };
        this.p2 = {
            buttons: {
                a: false,
                b: false,
                select: false,
                start: false,
                up: false,
                down: false,
                left: false,
                right: false
            },
            strobe: false,
            shiftReg: []
        };
    }
    setStrobe(on) {
        this.p1.strobe = on;
        this.p2.strobe = on;
        if (!on) {
            this.p1.shiftReg = [];
            this.p2.shiftReg = [];
            let keys = Object.getOwnPropertyNames(this.p1.buttons);
            for (let i = 0; i < keys.length; i++) {
                this.p1.shiftReg.push(+this.p1.buttons[keys[i]]);
                this.p2.shiftReg.push(+this.p2.buttons[keys[i]]);
            }
        }
    }
    read(addr) {
        let p = (addr == 0x4016) ? this.p1 : this.p2;
        if (p.strobe)
            return +p.buttons.a;
        if (p.shiftReg.length == 0)
            return 1;
        return p.shiftReg.shift();
    }
    //Sets the button flag, returns if the key pressed was used
    setBtn(keyCode, isDown) {
        let p1 = this.p1.buttons;
        let p2 = this.p2.buttons;
        let bind1 = this.bindings.p1;
        let bind2 = this.bindings.p2;
        switch (keyCode) {
            case bind1.a.code:
                p1.a = isDown;
                return true;
            case bind1.b.code:
                p1.b = isDown;
                return true;
            case bind1.select.code:
                p1.select = isDown;
                return true;
            case bind1.start.code:
                p1.start = isDown;
                return true;
            case bind1.up.code:
                p1.up = isDown;
                return true;
            case bind1.down.code:
                p1.down = isDown;
                return true;
            case bind1.left.code:
                p1.left = isDown;
                return true;
            case bind1.right.code:
                p1.right = isDown;
                return true;
            case bind2.a.code:
                p2.a = isDown;
                return true;
            case bind2.b.code:
                p2.b = isDown;
                return true;
            case bind2.select.code:
                p2.select = isDown;
                return true;
            case bind2.start.code:
                p2.start = isDown;
                return true;
            case bind2.up.code:
                p2.up = isDown;
                return true;
            case bind2.down.code:
                p2.down = isDown;
                return true;
            case bind2.left.code:
                p2.left = isDown;
                return true;
            case bind2.right.code:
                p2.right = isDown;
                return true;
        }
        return false;
    }
    reset() {
        //Copy default binds into the current bindings
        let players = Object.getOwnPropertyNames(this.bindings);
        for (let i = 0; i < players.length; i++) {
            let btns = Object.getOwnPropertyNames(this.bindings[players[i]]);
            for (let j = 0; j < btns.length; j++) {
                let b = this.bindings[players[i]][btns[j]];
                let props = Object.getOwnPropertyNames(b);
                for (let k = 0; k < props.length; k++) {
                    this.bindings[players[i]][btns[j]][props[k]] =
                        this.defaultBind[players[i]][btns[j]][props[k]];
                }
            }
        }
        let btns = $("#p1Controls > table > tr > td:nth-child(2) > button");
        let bind = this.bindings.p1;
        let keys = Object.getOwnPropertyNames(bind);
        for (let i = 0; i < keys.length; i++) {
            btns[i].innerHTML = bind[keys[i]].name;
        }
        btns = $("#p2Controls > table > tr > td:nth-child(2) > button");
        bind = this.bindings.p2;
        keys = Object.getOwnPropertyNames(bind);
        for (let i = 0; i < keys.length; i++) {
            btns[i].innerHTML = bind[keys[i]].name;
        }
        localStorage.setItem("bindings", JSON.stringify(this.bindings));
    }
    buildControlTable(div, p1 = true) {
        let pStr = (p1) ? "p1" : "p2";
        let bind = this.bindings[pStr];
        let table = $(document.createElement("table"));
        let keys = Object.getOwnPropertyNames(bind);
        for (let i = 0; i < keys.length; i++) {
            let btn = $(document.createElement("button"));
            btn.html(bind[keys[i]].name);
            btn.on("click", function () {
                btn.html("Press any key...");
                $(document).one("keydown", function (e) {
                    if (e.keyCode == 27) {
                        //If user hits "Escape" key, cancel button change
                        btn.html(bind[keys[i]].name);
                        return;
                    }
                    //Capture new key binding
                    btn.html(e.key);
                    if (e.key.length == 1)
                        btn.html(btn.html().toUpperCase());
                    if (e.keyCode == 32)
                        btn.html("Space");
                    bind[keys[i]].code = e.keyCode;
                    bind[keys[i]].name = btn.html();
                    localStorage.setItem("bindings", JSON.stringify(this.bindings));
                }.bind(this));
            }.bind(this));
            let tr = $(document.createElement("tr"));
            tr.append(`<td>${keys[i]}</td>`);
            let td = $(document.createElement("td"));
            td.append(btn);
            table.append(tr.append(td));
        }
        div.append(table);
        if (!p1) {
            let defBtn = $(document.createElement("button"));
            defBtn.html("Restore Defaults");
            defBtn.on("click", input.reset.bind(this));
            div.after(defBtn);
            div.after("<br>");
        }
    }
}
class Mapper {
    constructor(nes, header, cpuMem, ppuMem) {
        this.nes = nes;
        this.header = header;
        this.cpuMem = cpuMem;
        this.ppuMem = ppuMem;
    }
    //Allow mapper to watch sections of cpuMem. Return true or false to allow
    //nes to actually write new value to cpuMem
    notifyWrite(addr, byte) {
        return true;
    }
    load() { }
}
//Mapper 0
class NROM extends Mapper {
    constructor(nes, buff, header, cpuMem, ppuMem) {
        super(nes, header, cpuMem, ppuMem);
        this.pgrRom = [];
        this.chrRom = [];
        //Start loading memory
        let startLoc = 0x10;
        if (header.trainerPresent) {
            console.log("Trainer Data not yet supported.");
            startLoc += 0x200;
        }
        for (let i = 0; i < header.pgrPages; i++) {
            this.pgrRom.push(new Uint8Array(buff.slice(startLoc, startLoc + 0x4000)));
            startLoc += 0x4000;
        }
        for (let i = 0; i < header.chrPages; i++) {
            this.chrRom.push(new Uint8Array(buff.slice(startLoc, startLoc + 0x2000)));
            startLoc += 0x2000;
        }
    }
    load() {
        this.cpuMem.set(this.pgrRom[0], 0x8000);
        if (this.pgrRom.length > 1) {
            this.cpuMem.set(this.pgrRom[1], 0xC000);
        }
        else {
            this.cpuMem.set(this.pgrRom[0], 0xC000);
        }
        if (this.chrRom.length > 0) {
            this.ppuMem.set(this.chrRom[0], 0);
        }
    }
}
//Mapper 1
class MMC1 extends Mapper {
    constructor(nes, buff, header, cpuMem, ppuMem) {
        super(nes, header, cpuMem, ppuMem);
        this.pgrRom = [];
        this.chrRom = [];
        //0/1: switch 32 KB at $8000, ignoring low bit of bank number
        //2: fix first bank at $8000 and switch 16 KB bank at $C000
        //3: fix last bank at $C000 and switch 16 KB bank at $8000
        this.pgrBankMode = 0;
        //Switch 4 or 8KB at a time
        this.chrRom4KB = false;
        this.shiftReg = 1 << 4;
        this.ntRAM = new Uint8Array(0x800);
        //Start loading memory
        let startLoc = 0x10;
        if (header.trainerPresent) {
            console.log("Trainer Data not yet supported.");
            startLoc += 0x200;
        }
        for (let i = 0; i < header.pgrPages; i++) {
            this.pgrRom.push(new Uint8Array(buff.slice(startLoc, startLoc + 0x4000)));
            startLoc += 0x4000;
        }
        for (let i = 0; i < header.chrPages * 2; i++) {
            this.chrRom.push(new Uint8Array(buff.slice(startLoc, startLoc + 0x1000)));
            startLoc += 0x1000;
        }
        nes.ppu.singleScreenMirror = true;
    }
    notifyWrite(addr, data) {
        if (addr >= 0x8000) {
            if ((data & 0x80) != 0) {
                this.shiftReg = 1 << 4;
                this.pgrBankMode = 3;
            }
            else if (this.shiftReg % 2 == 1) {
                //Shift register is full
                data = ((data & 1) << 4) + (this.shiftReg >> 1);
                data &= 0x1F;
                this.shiftReg = 1 << 4;
                if (addr >= 0xE000) {
                    //PRG Bank
                    switch (this.pgrBankMode) {
                        case 0:
                            this.cpuMem.set(this.pgrRom[(data & 0xE)], 0x8000);
                            this.cpuMem.set(this.pgrRom[(data & 0xE) + 1], 0xC000);
                            break;
                        case 1:
                            this.cpuMem.set(this.pgrRom[(data & 0xE)], 0x8000);
                            this.cpuMem.set(this.pgrRom[(data & 0xE) + 1], 0xC000);
                            break;
                        case 2:
                            this.cpuMem.set(this.pgrRom[0], 0x8000);
                            this.cpuMem.set(this.pgrRom[data & 0xF], 0xC000);
                            break;
                        case 3:
                            this.cpuMem.set(this.pgrRom[data & 0xF], 0x8000);
                            this.cpuMem.set(this.pgrRom[this.pgrRom.length - 1], 0xC000);
                            break;
                    }
                }
                else if (addr >= 0xC000) {
                    //CHR Bank 1
                    if (!this.chrRom4KB || this.chrRom.length == 0)
                        return false;
                    this.ppuMem.set(this.chrRom[(data & 0x1F)], 0x1000);
                }
                else if (addr >= 0xA000) {
                    //CHR Bank 0
                    if (this.chrRom.length == 0)
                        return false;
                    if (this.chrRom4KB) {
                        this.ppuMem.set(this.chrRom[(data & 0x1F)], 0);
                    }
                    else {
                        this.ppuMem.set(this.chrRom[(data & 0x1E)], 0);
                        this.ppuMem.set(this.chrRom[(data & 0x1E) + 1], 0x1000);
                    }
                }
                else {
                    //Control Register
                    this.chrRom4KB = (data & 0x10) != 0;
                    this.pgrBankMode = (data & 0xC) >> 2;
                    let single = this.nes.ppu.singleScreenMirror;
                    let vert = this.nes.ppu.mirrorVertical;
                    if ((vert != ((data & 1) == 0)) || (single != ((data & 2) == 0))) {
                        //If mirroring is changing, update ntRAM
                        let mirror = (Number(!single) << 1) + Number(!vert);
                        switch (mirror) {
                            case 0:
                                this.ntRAM.set(this.ppuMem.slice(0x2000, 0x2400), 0);
                                break;
                            case 1:
                                this.ntRAM.set(this.ppuMem.slice(0x2400, 0x2800), 0x400);
                                break;
                            case 2:
                                this.ntRAM.set(this.ppuMem.slice(0x2000, 0x2800), 0);
                                break;
                            case 3:
                                this.ntRAM.set(this.ppuMem.slice(0x2000, 0x2400), 0);
                                this.ntRAM.set(this.ppuMem.slice(0x2800, 0x2C00), 0x400);
                                break;
                        }
                        //Set new data from ntRAM into PPU memory
                        switch (data & 3) {
                            case 0: {
                                let slice = this.ntRAM.slice(0, 0x400);
                                this.ppuMem.set(slice, 0x2000);
                                this.ppuMem.set(slice, 0x2400);
                                this.ppuMem.set(slice, 0x2800);
                                this.ppuMem.set(slice, 0x2C00);
                                break;
                            }
                            case 1:
                                {
                                    let slice = this.ntRAM.slice(0x400, 0x800);
                                    this.ppuMem.set(slice, 0x2000);
                                    this.ppuMem.set(slice, 0x2400);
                                    this.ppuMem.set(slice, 0x2800);
                                    this.ppuMem.set(slice, 0x2C00);
                                    break;
                                }
                            case 2:
                                this.ppuMem.set(this.ntRAM, 0x2000);
                                this.ppuMem.set(this.ntRAM, 0x2800);
                                break;
                            case 3: {
                                let slice = this.ntRAM.slice(0, 0x400);
                                this.ppuMem.set(slice, 0x2000);
                                this.ppuMem.set(slice, 0x2400);
                                slice = this.ntRAM.slice(0x400, 0x800);
                                this.ppuMem.set(slice, 0x2800);
                                this.ppuMem.set(slice, 0x2C00);
                                break;
                            }
                        }
                        this.nes.ppu.mirrorVertical = (data & 1) == 0;
                        this.nes.ppu.singleScreenMirror = (data & 2) == 0;
                    }
                }
            }
            else {
                this.shiftReg >>= 1;
                this.shiftReg += (data & 1) << 4;
            }
            return false;
        }
        return true;
    }
    load() {
        this.cpuMem.set(this.pgrRom[0], 0x8000);
        this.cpuMem.set(this.pgrRom[this.pgrRom.length - 1], 0xC000);
        if (this.chrRom.length == 0)
            return;
        this.ppuMem.set(this.chrRom[0], 0);
        if (this.chrRom.length == 1)
            return;
        this.ppuMem.set(this.chrRom[1], 0x1000);
    }
}
//Mapper 2
class UNROM extends Mapper {
    constructor(nes, buff, header, cpuMem, ppuMem) {
        super(nes, header, cpuMem, ppuMem);
        this.pgrRom = [];
        //Start loading memory
        let startLoc = 0x10;
        if (header.trainerPresent) {
            console.log("Trainer Data not yet supported.");
            startLoc += 0x200;
        }
        for (let i = 0; i < header.pgrPages; i++) {
            this.pgrRom.push(new Uint8Array(buff.slice(startLoc, startLoc + 0x4000)));
            startLoc += 0x4000;
        }
    }
    notifyWrite(addr, data) {
        if (addr >= 0x8000 && addr <= 0xFFFF) {
            data &= 7;
            this.cpuMem.set(this.pgrRom[data], 0x8000);
            return false;
        }
        return true;
    }
    load() {
        this.cpuMem.set(this.pgrRom[0], 0x8000);
        this.cpuMem.set(this.pgrRom[this.pgrRom.length - 1], 0xC000);
    }
}
//Mapper 3
class CNROM extends Mapper {
    constructor(nes, buff, header, cpuMem, ppuMem) {
        super(nes, header, cpuMem, ppuMem);
        this.pgrRom = [];
        this.chrRom = [];
        //Start loading memory
        let startLoc = 0x10;
        if (header.trainerPresent) {
            console.log("Trainer Data not yet supported.");
            startLoc += 0x200;
        }
        for (let i = 0; i < header.pgrPages; i++) {
            this.pgrRom.push(new Uint8Array(buff.slice(startLoc, startLoc + 0x4000)));
            startLoc += 0x4000;
        }
        for (let i = 0; i < header.chrPages; i++) {
            this.chrRom.push(new Uint8Array(buff.slice(startLoc, startLoc + 0x2000)));
            startLoc += 0x2000;
        }
    }
    notifyWrite(addr, data) {
        if (addr >= 0x8000 && addr <= 0xFFFF) {
            data &= 3;
            this.ppuMem.set(this.chrRom[data], 0);
            return false;
        }
        return true;
    }
    load() {
        this.cpuMem.set(this.pgrRom[0], 0x8000);
        if (this.pgrRom.length > 1) {
            this.cpuMem.set(this.pgrRom[1], 0xC000);
        }
        else {
            this.cpuMem.set(this.pgrRom[0], 0xC000);
        }
        this.ppuMem.set(this.chrRom[0], 0);
    }
}
//Mapper 4
class MMC3 extends Mapper {
    constructor(nes, buff, header, cpuMem, ppuMem) {
        super(nes, header, cpuMem, ppuMem);
        this.pgrRom = [];
        this.chrRom = [];
        this.bankSelect = 0;
        this.pgrSwap = false;
        this.xorChrAddr = false;
        this.irqCount = 0;
        this.irqReload = 0;
        this.irqEnabled = false;
        this.reload = false;
        //Start loading memory
        let startLoc = 0x10;
        let pgrBankSize = 0x2000;
        let chrBankSize = 0x400;
        if (header.trainerPresent) {
            console.log("Trainer Data not yet supported.");
            startLoc += 0x200;
        }
        for (let i = 0; i < header.pgrPages * 2; i++) {
            this.pgrRom.push(new Uint8Array(buff.slice(startLoc, startLoc + pgrBankSize)));
            startLoc += pgrBankSize;
        }
        for (let i = 0; i < header.chrPages * 8; i++) {
            this.chrRom.push(new Uint8Array(buff.slice(startLoc, startLoc + chrBankSize)));
            startLoc += chrBankSize;
        }
    }
    notifyWrite(addr, data) {
        if (addr < 0x8000)
            return true;
        if (addr < 0xA000) {
            if ((addr & 1) == 0) {
                //0x8000
                this.bankSelect = data & 7;
                this.xorChrAddr = (data & (1 << 7)) != 0;
                let pgrSwap = (data & (1 << 6)) != 0;
                if (pgrSwap != this.pgrSwap) {
                    if (this.pgrSwap) {
                        this.cpuMem.set(this.cpuMem.slice(0x8000, 0xA000), 0xC000);
                        this.cpuMem.set(this.pgrRom[this.pgrRom.length - 2], 0x8000);
                    }
                    else {
                        this.cpuMem.set(this.cpuMem.slice(0xC000, 0xE000), 0x8000);
                        this.cpuMem.set(this.pgrRom[this.pgrRom.length - 2], 0xC000);
                    }
                }
                this.pgrSwap = pgrSwap;
            }
            else {
                //0x8001
                let chrAddr;
                switch (this.bankSelect) {
                    case 0:
                        if (this.chrRom.length == 0)
                            break;
                        chrAddr = 0;
                        if (this.xorChrAddr)
                            chrAddr ^= 0x1000;
                        data &= this.chrRom.length - 1;
                        this.ppuMem.set(this.chrRom[data], chrAddr);
                        this.ppuMem.set(this.chrRom[data + 1], chrAddr + 0x400);
                        break;
                    case 1:
                        if (this.chrRom.length == 0)
                            break;
                        chrAddr = 0x800;
                        if (this.xorChrAddr)
                            chrAddr ^= 0x1000;
                        data &= this.chrRom.length - 1;
                        this.ppuMem.set(this.chrRom[data], chrAddr);
                        this.ppuMem.set(this.chrRom[data + 1], chrAddr + 0x400);
                        break;
                    case 2:
                        if (this.chrRom.length == 0)
                            break;
                        chrAddr = 0x1000;
                        if (this.xorChrAddr)
                            chrAddr ^= 0x1000;
                        data &= this.chrRom.length - 1;
                        this.ppuMem.set(this.chrRom[data], chrAddr);
                        break;
                    case 3:
                        if (this.chrRom.length == 0)
                            break;
                        chrAddr = 0x1400;
                        if (this.xorChrAddr)
                            chrAddr ^= 0x1000;
                        data &= this.chrRom.length - 1;
                        this.ppuMem.set(this.chrRom[data], chrAddr);
                        break;
                    case 4:
                        if (this.chrRom.length == 0)
                            break;
                        chrAddr = 0x1800;
                        if (this.xorChrAddr)
                            chrAddr ^= 0x1000;
                        data &= this.chrRom.length - 1;
                        this.ppuMem.set(this.chrRom[data], chrAddr);
                        break;
                    case 5:
                        if (this.chrRom.length == 0)
                            break;
                        chrAddr = 0x1C00;
                        if (this.xorChrAddr)
                            chrAddr ^= 0x1000;
                        data &= this.chrRom.length - 1;
                        this.ppuMem.set(this.chrRom[data], chrAddr);
                        break;
                    case 6:
                        data &= this.pgrRom.length - 1;
                        if (this.pgrSwap) {
                            this.cpuMem.set(this.pgrRom[data], 0xC000);
                        }
                        else {
                            this.cpuMem.set(this.pgrRom[data], 0x8000);
                        }
                        break;
                    case 7:
                        data &= this.pgrRom.length - 1;
                        this.cpuMem.set(this.pgrRom[data], 0xA000);
                        break;
                }
            }
        }
        else if (addr < 0xC000) {
            if ((addr & 1) == 0) {
                let mirrorVert = (data & 1) == 0;
                if (mirrorVert != this.nes.ppu.mirrorVertical) {
                    let slice1 = this.nes.ppu.mem.slice(0x2400, 0x2800);
                    let slice2 = this.nes.ppu.mem.slice(0x2800, 0x2C00);
                    this.nes.ppu.mem.set(slice1, 0x2800);
                    this.nes.ppu.mem.set(slice2, 0x2400);
                }
                this.nes.ppu.mirrorVertical = mirrorVert;
            }
        }
        else if (addr < 0xE000) {
            if ((addr & 1) == 0) {
                //IRQ latch
                this.irqReload = data;
            }
            else {
                //IRQ reload
                this.reload = true;
            }
        }
        else {
            if ((addr & 1) == 0) {
                //IRQ disable/ack
                this.irqEnabled = false;
                this.nes.cpu.mmc3IRQ = false;
            }
            else {
                //IRQ enable
                this.irqEnabled = true;
            }
        }
        return false;
    }
    decIRQ() {
        //Only decrement if sprite or bkg rendering is on
        if (!this.nes.ppu.showBkg && !this.nes.ppu.showSprites)
            return;
        if (this.reload || this.irqCount == 0) {
            this.irqCount = this.irqReload;
            this.reload = false;
        }
        else if (--this.irqCount == 0 && this.irqEnabled) {
            this.nes.cpu.mmc3IRQ = true;
        }
    }
    load() {
        this.cpuMem.set(this.pgrRom[0], 0x8000);
        this.cpuMem.set(this.pgrRom[1], 0xA000);
        this.cpuMem.set(this.pgrRom[this.pgrRom.length - 2], 0xC000);
        this.cpuMem.set(this.pgrRom[this.pgrRom.length - 1], 0xE000);
        if (this.chrRom.length > 0) {
            for (let i = 0; i < 8; i++) {
                this.ppuMem.set(this.chrRom[i], i * 0x400);
            }
        }
    }
}
/// <reference path="helper.ts" />
/// <reference path="mapper.ts" />
class iNESFile {
    constructor(buff, nes) {
        this.id = md5(buff.toString());
        //Check if valid iNES file (file starts with 'NES' and character break)
        if (buff[0] !== 0x4E)
            throw Error("Corrupted iNES file!"); //N
        if (buff[1] !== 0x45)
            throw Error("Corrupted iNES file!"); //E
        if (buff[2] !== 0x53)
            throw Error("Corrupted iNES file!"); //S
        if (buff[3] !== 0x1A)
            throw Error("Corrupted iNES file!"); //[END]
        this.pgrPages = buff[4]; //PGR size
        this.chrPages = buff[5]; //CHR size
        //Split byte 6 into mapper # and settings byte
        let byte = buff[6];
        let mask = 0xF << 4;
        this.mapNum = (byte & mask) >> 4;
        //Parse settings
        mask = 1;
        nes.ppu.mirrorVertical = (byte & mask) != 0;
        mask = 1 << 1;
        this.batteryBacked = (byte & mask) != 0;
        mask = 1 << 2;
        this.trainerPresent = (byte & mask) != 0;
        mask = 1 << 3;
        this.fourScreenMode = (byte & mask) != 0;
        //Byte 7
        byte = buff[7];
        //Check if this is an iNes 2.0 header
        mask = 3 << 2;
        this.nes2_0 = ((byte & mask) >> 2) == 2;
        if (this.nes2_0) {
            mask = 0xF << 4;
            //Get the hiByte of the mapper #
            this.mapNum = this.mapNum | (byte & mask);
            //Get additional settings
            mask = 1;
            this.vsGame = (byte & mask) != 0;
            mask = 1 << 1;
            this.isPC10 = (byte & mask) != 0;
            //TODO: Parse byte 8
            //Byte 9
            byte = buff[9];
            mask = 0xF;
            this.pgrPages = ((byte & mask) << 4) | this.pgrPages;
            mask <<= 4;
            this.chrPages = (byte & mask) | this.chrPages;
            //Byte 10
            byte = buff[10];
            mask = 0xF;
            this.pgrRamSize = byte & mask;
            mask <<= 4;
            this.pgrRamBattSize = (byte & mask) >> 4;
            //Byte 11
            byte = buff[11];
            mask = 0xF;
            this.chrRamSize = byte & mask;
            mask <<= 4;
            this.chrRamBattSize = (byte & mask) >> 4;
            //Byte 12
            byte = buff[12];
            mask = 1;
            this.isPAL = (byte & mask) != 0;
            mask = 1 << 1;
            this.bothFormats = (byte & mask) != 0;
            //TODO: Byte 13 (Vs. Hardware)
            //TODO: Byte 14 (Misc. ROMs)
        }
        //Initiate Mapper
        switch (this.mapNum) {
            case 0:
                if (this.chrPages > 1) {
                    this.mapper = new CNROM(nes, buff, this, nes.mainMemory, nes.ppu.mem);
                }
                else if (this.pgrPages > 2) {
                    this.mapper = new UNROM(nes, buff, this, nes.mainMemory, nes.ppu.mem);
                }
                else {
                    this.mapper = new NROM(nes, buff, this, nes.mainMemory, nes.ppu.mem);
                }
                break;
            case 1:
                this.mapper = new MMC1(nes, buff, this, nes.mainMemory, nes.ppu.mem);
                break;
            case 2:
                this.mapper = new UNROM(nes, buff, this, nes.mainMemory, nes.ppu.mem);
                break;
            case 3:
                this.mapper = new CNROM(nes, buff, this, nes.mainMemory, nes.ppu.mem);
                break;
            case 4:
                this.mapper = new MMC3(nes, buff, this, nes.mainMemory, nes.ppu.mem);
                break;
            default: //Unsupported Mapper
                alert("Warning: Unsupported Mapper\nThis game is not yet supported.");
        }
    }
}
class PPU {
    constructor(nes) {
        this.nes = nes;
        this.oamBuff = [];
        this.sprite0Active = false;
        this.singleScreenMirror = false;
        this.internalReadBuff = 0;
        this.oddFrame = false;
        this.writeLatch = false;
        this.vRamAddr = 0;
        this.initRamAddr = 0;
        this.fineX = 0;
        this.scanline = 261;
        this.dot = 0;
        //Shift registers
        this.bkgQ = [];
        this.attrQ = [];
        this.addrQ = [];
        //CTRL vars
        this.incAddrBy32 = false; //If false, inc by 1
        this.spritePatAddr = 0;
        this.bkgPatAddr = 0;
        this.sprite8x16 = false; //If false, sprite size is 8x8
        this.vBlankNMI = false;
        //MASK vars
        this.greyscale = false;
        this.showLeftBkg = false;
        this.showLeftSprite = false;
        this.showBkg = false;
        this.showSprites = false;
        this.maxRed = false;
        this.maxGreen = false;
        this.maxBlue = false;
        this.PPUCTRL = 0x2000;
        this.PPUMASK = 0x2001;
        this.PPUSTATUS = 0x2002;
        this.OAMADDR = 0x2003;
        this.OAMDATA = 0x2004;
        this.PPUSCROLL = 0x2005;
        this.PPUADDR = 0x2006;
        this.PPUDATA = 0x2007;
        this.OAMDMA = 0x4014;
        this.mem = new Uint8Array(0x4000);
        this.oam = new Uint8Array(0x100);
        PPU.updateScale(PPU.scale);
    }
    static updateScale(scale) {
        if (scale < 1 || scale % 1 != 0) {
            console.log("Display scale must a positive integer");
            return;
        }
        PPU.scale = scale;
        PPU.canvas.width = 256 * scale;
        PPU.canvas.height = 240 * scale;
        let ctx = PPU.canvas.getContext("2d", { alpha: false });
        ctx.imageSmoothingEnabled = false;
        let imgData = ctx.createImageData(PPU.canvas.width, PPU.canvas.height);
        PPU.ctx = ctx;
        PPU.imageData = imgData;
        PPU.imageWidth = imgData.width;
        //Create a buffer with 8 & 32-bit views to store pixel data b4 render
        let buff = new ArrayBuffer(imgData.data.length);
        PPU.pixBuff8 = new Uint8Array(buff);
        PPU.pixBuff32 = new Uint32Array(buff);
    }
    setPixel(r, g, b) {
        if (this.maxGreen || this.maxBlue) {
            r -= 25;
        }
        if (this.maxRed || this.maxBlue) {
            g -= 25;
        }
        if (this.maxRed || this.maxGreen) {
            b -= 25;
        }
        let i = (this.scanline * PPU.imageWidth + this.dot) * PPU.scale;
        let pixVal = (PPU.isLittleEndian) ?
            0xFF000000 | (b << 16) | (g << 8) | r :
            (r << 24) | (g << 16) | (b << 8) | 0xFF;
        for (let x = 0; x < PPU.scale; x++) {
            for (let y = 0; y < PPU.scale; y++) {
                PPU.pixBuff32[i + x + (y * PPU.imageWidth)] = pixVal;
            }
        }
    }
    paintFrame() {
        PPU.imageData.data.set(PPU.pixBuff8);
        PPU.ctx.putImageData(PPU.imageData, 0, 0);
    }
    boot() {
        this.nes.write(this.PPUCTRL, 0);
        this.nes.write(this.PPUMASK, 0);
        this.nes.write(this.PPUSTATUS, 0xA0);
        this.nes.write(this.OAMADDR, 0);
        this.nes.write(this.PPUSCROLL, 0);
        this.nes.write(this.PPUADDR, 0);
        this.nes.write(this.PPUDATA, 0);
        this.oddFrame = false;
    }
    reset() {
        this.nes.write(this.PPUCTRL, 0);
        this.nes.write(this.PPUMASK, 0);
        this.nes.write(this.PPUSCROLL, 0);
        this.nes.write(this.PPUDATA, 0);
        this.oddFrame = false;
    }
    getState() {
        let obj = {};
        let ignoreList = ["nes", "PPUCTRL", "PPUMASK", "PPUSTATUS", "OAMADDR",
            "OAMDATA", "PPUSCROLL", "PPUADDR", "PPUDATA", "OAMDMA"];
        let keys = Object.keys(this);
        for (let i = 0; i < keys.length; i++) {
            if (ignoreList.includes(keys[i]))
                continue;
            if (keys[i] == "mem" || keys[i] == "oam") {
                obj[keys[i]] = this[keys[i]].toString();
            }
            else {
                obj[keys[i]] = this[keys[i]];
            }
        }
        return obj;
    }
    loadState(state) {
        let keys = Object.keys(state);
        for (let i = 0; i < keys.length; i++) {
            if (keys[i] == "mem") {
                //Parse memory str
                let arr = state[keys[i]].split(",");
                let buff = new Uint8Array(this.mem.length);
                for (let i = 0; i < buff.length; i++) {
                    buff[i] = parseInt(arr[i]);
                }
                this.mem.set(buff);
            }
            else if (keys[i] == "oam") {
                //Parse oam str
                let arr = state[keys[i]].split(",");
                let buff = new Uint8Array(this.oam.length);
                for (let i = 0; i < buff.length; i++) {
                    buff[i] = parseInt(arr[i]);
                }
                this.oam.set(buff);
            }
            else {
                this[keys[i]] = state[keys[i]];
            }
        }
    }
    cycle() {
        if (this.oddFrame && this.scanline == 0 && this.dot == 0) {
            this.dot++;
        }
        switch (true) {
            case (this.scanline < 240):
                this.visibleCycle();
                break;
            case (this.scanline == 241):
                if (this.dot == 1)
                    this.setVBL();
                //POST-RENDER
                break;
            case (this.scanline == 261):
                //PRE-RENDER
                if (this.dot == 1) {
                    this.clearVBL();
                    this.clearSprite0();
                    this.clearOverflow();
                }
                else if (this.dot == 328) {
                    this.addrQ[0] = this.vRamAddr;
                    //Get attrTable byte
                    this.attrQ[0] = this.mem[this.getATAddr()];
                    let addr = this.mem[this.getNTAddr()] << 4;
                    let fineY = (this.vRamAddr & 0x7000) >> 12;
                    //Get Low BG byte
                    let lo = this.mem[addr + fineY + this.bkgPatAddr];
                    //Get High BG byte
                    let hi = this.mem[addr + 8 + fineY + this.bkgPatAddr];
                    this.bkgQ[0] = this.combinePatData(hi, lo);
                    if (this.showBkg || this.showSprites)
                        this.incCoarseX();
                }
                else if (this.dot == 336) {
                    this.addrQ[1] = this.vRamAddr;
                    //Get attrTable byte
                    this.attrQ[1] = this.mem[this.getATAddr()];
                    let addr = this.mem[this.getNTAddr()] << 4;
                    let fineY = (this.vRamAddr & 0x7000) >> 12;
                    //Get Low BG byte
                    let lo = this.mem[addr + fineY + this.bkgPatAddr];
                    //Get High BG byte
                    let hi = this.mem[addr + 8 + fineY + this.bkgPatAddr];
                    this.bkgQ[1] = this.combinePatData(hi, lo);
                    if (this.showBkg || this.showSprites)
                        this.incCoarseX();
                }
                break;
        }
        if (++this.dot > 340) {
            this.dot = 0;
            if (++this.scanline > 261) {
                this.scanline = 0;
                this.oddFrame = !this.oddFrame;
            }
        }
        //Reset pointers
        if (this.dot == 1 && this.scanline == 261) {
            if (this.showBkg || this.showSprites)
                this.vRamAddr = this.initRamAddr;
        }
        if (this.scanline == 239 && this.dot == 256) {
            this.nes.drawFrame = true;
        }
    }
    visibleCycle() {
        if (!this.showBkg && !this.showSprites) {
            if (this.dot < 256) {
                this.render();
            }
            return;
        }
        if (this.dot <= 256) {
            if (this.dot % 8 == 0 && this.dot != 0) {
                this.addrQ[1] = this.vRamAddr;
                //Get attrTable byte
                this.attrQ[1] = this.mem[this.getATAddr()];
                let addr = this.mem[this.getNTAddr()] << 4;
                let fineY = (this.vRamAddr & 0x7000) >> 12;
                //Get Low BG byte
                let lo = this.mem[addr + fineY + this.bkgPatAddr];
                //Get High BG byte
                let hi = this.mem[addr + 8 + fineY + this.bkgPatAddr];
                this.bkgQ[1] = this.combinePatData(hi, lo);
                //Inc NT Pointer
                if (this.dot < 256) {
                    this.incCoarseX();
                }
                else {
                    this.resetCoarseX();
                    this.incY();
                    if (this.scanline == 239) {
                        this.resetCoarseY();
                    }
                }
            }
            if (this.dot < 256) {
                this.render();
            }
        }
        else if (this.dot == 257) {
            //Sprite evaulation for next scanline
            this.sprite0Active = false;
            this.oamBuff = [];
            for (let i = 0; i < this.oam.length; i += 4) {
                //If sprite is visible on scanline, add it to 2nd OAM
                if (this.oam[i] <= this.scanline) {
                    if (this.oam[i] > this.scanline - 8 || (this.oam[i] > this.scanline - 16 && this.sprite8x16)) {
                        let entry = {
                            x: 0,
                            patData: [],
                            paletteNum: 0,
                            priority: false,
                            isSprite0: false
                        };
                        if (i == 0) {
                            entry.isSprite0 = true;
                            this.sprite0Active = true;
                        }
                        entry.x = this.oam[i + 3];
                        entry.paletteNum = (this.oam[i + 2] & 3) + 4;
                        entry.priority = (this.oam[i + 2] & 0x20) == 0;
                        let offSet = this.scanline - this.oam[i];
                        //Flip vertically
                        if ((this.oam[i + 2] & 0x80) != 0) {
                            if (this.sprite8x16) {
                                offSet = 15 - offSet;
                            }
                            else {
                                offSet = 7 - offSet;
                            }
                        }
                        let addr;
                        let lo;
                        let hi;
                        if (this.sprite8x16) {
                            addr = this.oam[i + 1] >> 1;
                            if (offSet > 7)
                                offSet += 8;
                            addr = addr << 5;
                            addr += ((this.oam[i + 1] & 1) == 0) ? 0 : 0x1000;
                            lo = this.mem[addr + offSet];
                            hi = this.mem[addr + offSet + 8];
                        }
                        else {
                            addr = this.oam[i + 1] << 4;
                            lo = this.mem[addr + offSet + this.spritePatAddr];
                            hi = this.mem[addr + offSet + this.spritePatAddr + 8];
                        }
                        entry.patData = this.combinePatData(hi, lo);
                        //Flip horizontally
                        if (this.oam[i + 2] & 0x40)
                            entry.patData = entry.patData.reverse();
                        this.oamBuff.push(entry);
                        if (this.oamBuff.length == 8)
                            break;
                    }
                }
            }
        }
        else if (this.dot == 328) {
            this.addrQ[0] = this.vRamAddr;
            //Get attrTable byte
            this.attrQ[0] = this.mem[this.getATAddr()];
            let addr = this.mem[this.getNTAddr()] << 4;
            let fineY = (this.vRamAddr & 0x7000) >> 12;
            //Get Low BG byte
            let lo = this.mem[addr + fineY + this.bkgPatAddr];
            //Get High BG byte
            let hi = this.mem[addr + 8 + fineY + this.bkgPatAddr];
            this.bkgQ[0] = this.combinePatData(hi, lo);
            if (this.showBkg || this.showSprites)
                this.incCoarseX();
        }
        else if (this.dot == 336) {
            this.addrQ[1] = this.vRamAddr;
            //Get attrTable byte
            this.attrQ[1] = this.mem[this.getATAddr()];
            let addr = this.mem[this.getNTAddr()] << 4;
            let fineY = (this.vRamAddr & 0x7000) >> 12;
            //Get Low BG byte
            let lo = this.mem[addr + fineY + this.bkgPatAddr];
            //Get High BG byte
            let hi = this.mem[addr + 8 + fineY + this.bkgPatAddr];
            this.bkgQ[1] = this.combinePatData(hi, lo);
            if (this.showBkg || this.showSprites)
                this.incCoarseX();
        }
    }
    render() {
        let uBkgData = this.mem[0x3F00] & 0x3F;
        if (!this.showBkg) {
            //Get Universal Background Color and paint a blank pixel
            if (PPU.forceGreyscale || this.greyscale)
                uBkgData &= 0x30;
            if (!this.showSprites) {
                let col = colorData[uBkgData];
                this.setPixel(col.r, col.g, col.b);
                return;
            }
        }
        let bitSelect = this.dot % 8 + this.fineX;
        if (bitSelect > 7)
            bitSelect -= 8;
        let palData = this.getSpritePix(this.showBkg && this.bkgQ[0][bitSelect] != 0);
        if (!this.showBkg && palData == null) {
            let col = colorData[uBkgData];
            this.setPixel(col.r, col.g, col.b);
            return;
        }
        if (palData == null || !this.showSprites) {
            //Get background pixel
            //Get PALETTE NUMBER
            if (!this.showLeftBkg && this.dot < 8 || this.bkgQ[0][bitSelect] == 0) {
                palData = uBkgData;
            }
            else {
                let x = (((this.addrQ[0] & 0x1F) * 8) + this.fineX);
                let y = ((this.addrQ[0] & 0x03E0) >> 5) * 8 + ((this.addrQ[0] & 0x7000) >> 12);
                let quad;
                if (x % 32 < 16) {
                    quad = (y % 32 < 16) ? 0 : 2;
                }
                else {
                    quad = (y % 32 < 16) ? 1 : 3;
                }
                let palNum;
                let mask = 3 << (quad * 2);
                palNum = (this.attrQ[0] & mask) >> (quad * 2);
                let palInd = 0x3F00 + palNum * 4 + this.bkgQ[0][bitSelect];
                palData = this.mem[palInd] & 0x3F;
            }
        }
        if (PPU.forceGreyscale || this.greyscale)
            palData &= 0x30;
        let col = colorData[palData];
        this.setPixel(col.r, col.g, col.b);
        if (bitSelect % 8 == 7) {
            this.bkgQ[0] = this.bkgQ[1];
            this.attrQ[0] = this.attrQ[1];
            this.addrQ[0] = this.addrQ[1];
        }
    }
    getSpritePix(bkgIsVis) {
        if (!this.showSprites || (!this.showLeftSprite && this.dot < 8))
            return null;
        let entry;
        let pix;
        let sprite0Pix;
        for (let i = 0; i < this.oamBuff.length; i++) {
            if (this.oamBuff[i].x > this.dot - 8 && this.oamBuff[i].x <= this.dot) {
                entry = this.oamBuff[i];
                pix = entry.patData[this.dot - entry.x];
                if (pix == 0) {
                    entry = undefined;
                    pix = undefined;
                    continue;
                }
                if (entry.isSprite0)
                    sprite0Pix = pix;
                if (bkgIsVis && this.sprite0Active && sprite0Pix == undefined) {
                    //Finish searching secondary OAM for sprite0 only
                    for (i; i < this.oamBuff.length; i++) {
                        if (this.oamBuff[i].x > this.dot - 8 &&
                            this.oamBuff[i].x <= this.dot &&
                            this.oamBuff[i].isSprite0) {
                            sprite0Pix = this.oamBuff[i].patData[this.dot - this.oamBuff[i].x];
                            break;
                        }
                    }
                }
                break;
            }
        }
        if (entry === undefined)
            return null;
        if (bkgIsVis) {
            if (sprite0Pix !== undefined && sprite0Pix != 0)
                this.setSprite0();
            if (!entry.priority)
                return null;
        }
        let palInd = 0x3F00 + entry.paletteNum * 4 + pix;
        return this.mem[palInd] & 0x3F;
    }
    write(addr, data) {
        if (addr >= 0x3F00) {
            //Mirror Palette RAM
            if (addr % 4 == 0) {
                //Special case for background colors
                for (let i = 0x3F00; i < 0x4000; i += 0x10) {
                    this.mem[i + (addr % 0x10)] = data;
                }
            }
            else {
                for (let i = 0x3F00; i < 0x4000; i += 0x20) {
                    this.mem[i + (addr % 0x20)] = data;
                }
            }
        }
        else if (addr >= 0x2000 && addr <= 0x2EFF) {
            //Mirror Nametables
            this.mem[addr + 0x1000] = data;
        }
        else if (addr >= 0x3000 && addr < 0x3F00) {
            //Mirror Nametables
            this.mem[addr - 0x1000] = data;
        }
        this.mem[addr] = data;
    }
    readReg(addr) {
        switch (addr) {
            case this.PPUSTATUS:
                this.writeLatch = false;
                break;
            case this.OAMDATA:
                return this.oam[this.oamAddr];
            case this.PPUDATA:
                let res = this.internalReadBuff;
                if (this.vRamAddr >= 0x3F00) {
                    res = this.mem[this.vRamAddr];
                    this.internalReadBuff = this.mem[this.vRamAddr - 0x1000];
                }
                else {
                    this.internalReadBuff = this.mem[this.vRamAddr];
                }
                this.incVRAM();
                return res;
        }
        return;
    }
    writeReg(addr, byte) {
        switch (addr) {
            case this.PPUCTRL:
                let ntBit = byte & 3;
                this.initRamAddr = insertInto(this.initRamAddr, ntBit, 12, 2, 0);
                this.incAddrBy32 = (byte & 4) != 0;
                if ((byte & 8) != 0) {
                    this.spritePatAddr = 0x1000;
                }
                else {
                    this.spritePatAddr = 0;
                }
                if ((byte & 16) != 0) {
                    this.bkgPatAddr = 0x1000;
                }
                else {
                    this.bkgPatAddr = 0;
                }
                this.sprite8x16 = (byte & 32) != 0;
                this.vBlankNMI = (byte & 128) != 0;
                break;
            case this.PPUMASK:
                this.greyscale = (byte & 1) != 0;
                this.showLeftBkg = (byte & 2) != 0;
                this.showLeftSprite = (byte & 4) != 0;
                this.showBkg = (byte & 8) != 0;
                this.showSprites = (byte & 16) != 0;
                this.maxRed = (byte & 32) != 0;
                this.maxGreen = (byte & 64) != 0;
                this.maxBlue = (byte & 128) != 0;
                break;
            case this.PPUADDR:
                if (!this.writeLatch) {
                    this.initRamAddr = byte << 8;
                }
                else {
                    this.initRamAddr += byte;
                    this.initRamAddr &= 0x3FFF;
                    let oldBit = this.vRamAddr & (1 << 12);
                    this.vRamAddr = this.initRamAddr;
                    if (this.nes.rom.mapper instanceof MMC3 &&
                        oldBit != (this.vRamAddr & (1 << 12))) {
                        this.nes.rom.mapper.decIRQ();
                    }
                }
                this.writeLatch = !this.writeLatch;
                break;
            case this.PPUDATA:
                if (this.vRamAddr >= 0x2000 && this.vRamAddr <= 0x3000) {
                    if (this.singleScreenMirror) {
                        let addr = this.vRamAddr - 0x2000;
                        addr %= 0x400;
                        for (let i = 0x2000; i < 0x3000; i += 0x400) {
                            this.write(i + addr, byte);
                        }
                    }
                    else if (this.mirrorVertical) {
                        this.write(this.vRamAddr, byte);
                        if (this.vRamAddr < 0x2800) {
                            this.write(this.vRamAddr + 0x800, byte);
                        }
                        else {
                            this.write(this.vRamAddr - 0x800, byte);
                        }
                    }
                    else {
                        this.write(this.vRamAddr, byte);
                        if ((this.vRamAddr - 0x2000) % 0x800 < 0x400) {
                            this.write(this.vRamAddr + 0x400, byte);
                        }
                        else {
                            this.write(this.vRamAddr - 0x400, byte);
                        }
                    }
                }
                else {
                    this.write(this.vRamAddr, byte);
                }
                this.incVRAM();
                break;
            case this.OAMADDR:
                this.oamAddr = byte;
                break;
            case this.OAMDATA:
                this.oam[this.oamAddr++] = byte;
                if (this.oamAddr > 0xFF)
                    this.oamAddr = 0;
                break;
            case this.OAMDMA:
                let slice = this.nes.mainMemory.slice((byte << 8), ((byte + 1) << 8));
                if (this.oamAddr == 0) {
                    this.oam.set(slice, 0);
                }
                else {
                    let first = slice.slice(0, (0x100 - this.oamAddr));
                    let second = slice.slice((0x100 - this.oamAddr), 0x100);
                    this.oam.set(first, this.oamAddr);
                    this.oam.set(second, 0);
                }
                //Catch up to the 514 CPU cycles used
                for (let i = 0; i < 514 * 3; i++) {
                    this.cycle();
                }
                break;
            case this.PPUSCROLL:
                if (!this.writeLatch) {
                    this.initRamAddr = insertInto(this.initRamAddr, byte, 5, 8, 3);
                    this.fineX = byte & 7;
                }
                else {
                    this.initRamAddr = insertInto(this.initRamAddr, byte, 15, 3, 0);
                    this.initRamAddr = insertInto(this.initRamAddr, byte, 10, 8, 3);
                }
                this.writeLatch = !this.writeLatch;
                break;
        }
    }
    combinePatData(hi, lo) {
        let pByte = [];
        let mask;
        for (let i = 0; i < 8; i++) {
            mask = 1 << (7 - i);
            if (i > 6) {
                pByte[i] = ((hi & mask) << 1) +
                    (lo & mask);
            }
            else {
                pByte[i] = ((hi & mask) >> (6 - i)) +
                    ((lo & mask) >> (7 - i));
            }
        }
        return pByte;
    }
    incCoarseX() {
        if ((this.vRamAddr & 0x1F) == 31) {
            //Swap nametable, horizontally
            this.vRamAddr &= 0xFFE0; //Set X to 0
            this.vRamAddr ^= 0x400; //Swap NT
        }
        else {
            this.vRamAddr++;
        }
    }
    resetCoarseX() {
        this.vRamAddr = insertInto(this.vRamAddr, this.initRamAddr, 5, 5, 0);
        this.vRamAddr = insertInto(this.vRamAddr, this.initRamAddr, 11, 11, 10);
    }
    incY() {
        if ((this.vRamAddr & 0x7000) != 0x7000) {
            this.vRamAddr += 0x1000; //If fineY != 7, inc by 1
            if (this.nes.rom.mapper instanceof MMC3)
                this.nes.rom.mapper.decIRQ();
        }
        else {
            this.vRamAddr &= 0xFFF; //Reset fineY to 0
            let y = (this.vRamAddr & 0x3E0) >> 5;
            if (y == 29) {
                //Swap nametable, vertically
                y = 0;
                this.vRamAddr ^= 0x800; //Swap NT
            }
            else if (y == 31) {
                y = 0;
            }
            else {
                y += 1;
            }
            let mask = 0xFFFF;
            mask ^= 0x3E0;
            //Put y back into vRamAddr
            this.vRamAddr = (this.vRamAddr & mask) | (y << 5);
            if (this.nes.rom.mapper instanceof MMC3)
                this.nes.rom.mapper.decIRQ();
        }
    }
    resetCoarseY() {
        let oldBit = this.vRamAddr & (1 << 12);
        this.vRamAddr = insertInto(this.vRamAddr, this.initRamAddr, 10, 10, 5);
        this.vRamAddr = insertInto(this.vRamAddr, this.initRamAddr, 15, 15, 11);
        if (this.nes.rom.mapper instanceof MMC3 &&
            oldBit != (this.vRamAddr & (1 << 12))) {
            this.nes.rom.mapper.decIRQ();
        }
    }
    incVRAM() {
        if (this.incAddrBy32) {
            this.vRamAddr += 32;
        }
        else {
            this.vRamAddr++;
        }
        while (this.vRamAddr > 0x3FFF) {
            this.vRamAddr -= 0x4000;
        }
    }
    getNTAddr() {
        return 0x2000 | (this.vRamAddr & 0xFFF);
    }
    getATAddr() {
        return 0x23C0 | (this.vRamAddr & 0x0C00) | ((this.vRamAddr >> 4) & 0x38) | ((this.vRamAddr >> 2) & 0x07);
    }
    setVBL() {
        this.nes.write(this.PPUSTATUS, (this.nes.readNoReg(this.PPUSTATUS) | 0x80));
        if (this.vBlankNMI)
            this.nes.cpu.requestNMInterrupt();
    }
    clearVBL() {
        this.nes.write(this.PPUSTATUS, (this.nes.readNoReg(this.PPUSTATUS) & 0x7F));
    }
    clearSprite0() {
        this.nes.write(this.PPUSTATUS, (this.nes.readNoReg(this.PPUSTATUS) & 0xBF));
    }
    setSprite0() {
        this.nes.write(this.PPUSTATUS, (this.nes.readNoReg(this.PPUSTATUS) | 0x40));
    }
    clearOverflow() {
        this.nes.write(this.PPUSTATUS, (this.nes.readNoReg(this.PPUSTATUS) & 0xDF));
    }
}
PPU.forceGreyscale = false;
PPU.ctx = null;
PPU.imageData = null;
PPU.pixBuff8 = null;
PPU.pixBuff32 = null;
PPU.scale = 2;
let colorData = [{
        "r": 102,
        "g": 102,
        "b": 102
    }, {
        "r": 0,
        "g": 42,
        "b": 136
    }, {
        "r": 20,
        "g": 18,
        "b": 167
    }, {
        "r": 59,
        "g": 0,
        "b": 164
    }, {
        "r": 92,
        "g": 0,
        "b": 126
    }, {
        "r": 110,
        "g": 0,
        "b": 64
    }, {
        "r": 108,
        "g": 6,
        "b": 0
    }, {
        "r": 86,
        "g": 29,
        "b": 0
    }, {
        "r": 51,
        "g": 53,
        "b": 0
    }, {
        "r": 11,
        "g": 72,
        "b": 0
    }, {
        "r": 0,
        "g": 82,
        "b": 0
    }, {
        "r": 0,
        "g": 79,
        "b": 8
    }, {
        "r": 0,
        "g": 64,
        "b": 77
    }, {
        "r": 0,
        "g": 0,
        "b": 0
    }, {
        "r": 0,
        "g": 0,
        "b": 0
    }, {
        "r": 0,
        "g": 0,
        "b": 0
    }, {
        "r": 173,
        "g": 173,
        "b": 173
    }, {
        "r": 21,
        "g": 95,
        "b": 217
    }, {
        "r": 66,
        "g": 64,
        "b": 255
    }, {
        "r": 117,
        "g": 39,
        "b": 254
    }, {
        "r": 160,
        "g": 26,
        "b": 204
    }, {
        "r": 183,
        "g": 30,
        "b": 123
    }, {
        "r": 181,
        "g": 49,
        "b": 32
    }, {
        "r": 153,
        "g": 78,
        "b": 0
    }, {
        "r": 107,
        "g": 109,
        "b": 0
    }, {
        "r": 56,
        "g": 135,
        "b": 0
    }, {
        "r": 12,
        "g": 147,
        "b": 0
    }, {
        "r": 0,
        "g": 143,
        "b": 50
    }, {
        "r": 0,
        "g": 124,
        "b": 141
    }, {
        "r": 0,
        "g": 0,
        "b": 0
    }, {
        "r": 0,
        "g": 0,
        "b": 0
    }, {
        "r": 0,
        "g": 0,
        "b": 0
    }, {
        "r": 255,
        "g": 254,
        "b": 255
    }, {
        "r": 100,
        "g": 176,
        "b": 255
    }, {
        "r": 146,
        "g": 144,
        "b": 255
    }, {
        "r": 198,
        "g": 118,
        "b": 255
    }, {
        "r": 243,
        "g": 106,
        "b": 255
    }, {
        "r": 254,
        "g": 110,
        "b": 204
    }, {
        "r": 254,
        "g": 129,
        "b": 112
    }, {
        "r": 234,
        "g": 158,
        "b": 34
    }, {
        "r": 188,
        "g": 190,
        "b": 0
    }, {
        "r": 136,
        "g": 216,
        "b": 0
    }, {
        "r": 92,
        "g": 228,
        "b": 48
    }, {
        "r": 69,
        "g": 224,
        "b": 130
    }, {
        "r": 72,
        "g": 205,
        "b": 222
    }, {
        "r": 79,
        "g": 79,
        "b": 79
    }, {
        "r": 0,
        "g": 0,
        "b": 0
    }, {
        "r": 0,
        "g": 0,
        "b": 0
    }, {
        "r": 255,
        "g": 254,
        "b": 255
    }, {
        "r": 192,
        "g": 223,
        "b": 255
    }, {
        "r": 211,
        "g": 210,
        "b": 255
    }, {
        "r": 232,
        "g": 200,
        "b": 255
    }, {
        "r": 251,
        "g": 194,
        "b": 255
    }, {
        "r": 254,
        "g": 196,
        "b": 234
    }, {
        "r": 254,
        "g": 204,
        "b": 197
    }, {
        "r": 247,
        "g": 216,
        "b": 165
    }, {
        "r": 228,
        "g": 229,
        "b": 148
    }, {
        "r": 207,
        "g": 239,
        "b": 150
    }, {
        "r": 189,
        "g": 244,
        "b": 171
    }, {
        "r": 179,
        "g": 243,
        "b": 204
    }, {
        "r": 181,
        "g": 235,
        "b": 242
    }, {
        "r": 184,
        "g": 184,
        "b": 184
    }, {
        "r": 0,
        "g": 0,
        "b": 0
    }, {
        "r": 0,
        "g": 0,
        "b": 0
    }];
/// <reference path="rom.ts" />
/// <reference path="ppu.ts" />
/// <reference path="input.ts" />
class NES {
    constructor(romData, input) {
        this.MEM_SIZE = 0x10000;
        this.print = false;
        this.drawFrame = false;
        this.mainMemory = new Uint8Array(this.MEM_SIZE);
        this.ppu = new PPU(this);
        this.cpu = new CPU(this);
        this.apu = new APU(this);
        this.rom = new iNESFile(romData, this);
        if (this.rom.batteryBacked && localStorage.getItem(this.rom.id) !== null) {
            //Parse memory str
            let arr = localStorage.getItem(this.rom.id).split(",");
            let buff = new Uint8Array(0x2000);
            for (let i = 0; i < buff.length; i++) {
                buff[i] = parseInt(arr[i]);
            }
            //Load battery-backed RAM
            this.mainMemory.set(buff, 0x6000);
        }
        //Get save state for this game
        this.state = JSON.parse(localStorage.getItem("save_" + this.rom.id));
        $("#saveState").prop("disabled", false);
        $("#loadState").prop("disabled", this.state === null);
        //Set up input listeners
        this.input = input;
    }
    boot() {
        if (this.rom.mapper == undefined)
            return;
        this.ppu.boot();
        this.rom.mapper.load();
        this.cpu.boot();
        this.step();
    }
    reset() {
        window.cancelAnimationFrame(this.lastAnimFrame);
        this.ppu.reset();
        this.cpu.reset();
        this.apu.reset();
        this.step();
    }
    saveState() {
        if (NES.saveWarn && this.state !== null) {
            APU.masterGain.gain.setTargetAtTime(0, 0, 0.05);
            let cont = confirm("Are you sure?\nSaving now will replace your previous save data.");
            APU.masterGain.gain.setTargetAtTime(APU.masterVol, 0, 0.05);
            if (!cont)
                return;
        }
        this.state = this.getState();
        $("#loadState").prop("disabled", false);
    }
    storeState() {
        if (this.state == null)
            return;
        localStorage.setItem("save_" + this.rom.id, JSON.stringify(this.state));
    }
    getState() {
        return {
            mainMem: this.mainMemory.toString(),
            ppu: this.ppu.getState(),
            cpu: this.cpu.getState(),
            apu: this.apu.getState()
        };
    }
    loadState() {
        if (this.state === null)
            return;
        if (NES.saveWarn) {
            APU.masterGain.gain.setTargetAtTime(0, 0, 0.05);
            let cont = confirm("Are you sure?\nLoading previous save data will erase your current progress.");
            APU.masterGain.gain.setTargetAtTime(APU.masterVol, 0, 0.05);
            if (!cont)
                return;
        }
        //Parse mainMemory str
        let arr = this.state["mainMem"].split(",");
        let buff = new Uint8Array(this.mainMemory.length);
        for (let i = 0; i < buff.length; i++) {
            buff[i] = parseInt(arr[i]);
        }
        this.mainMemory.set(buff);
        //Load component states
        this.ppu.loadState(this.state["ppu"]);
        this.cpu.loadState(this.state["cpu"]);
        this.apu.loadState(this.state["apu"]);
    }
    step() {
        this.drawFrame = false;
        let error = false;
        while (!this.drawFrame) {
            try {
                let cpuCycles = this.cpu.step();
                for (let j = 0; j < cpuCycles * 3; j++) {
                    this.ppu.cycle();
                }
                for (let i = 0; i < cpuCycles; i++) {
                    this.apu.step();
                }
            }
            catch (e) {
                if (e.name == "Unexpected OpCode") {
                    console.log(e.message);
                    error = true;
                    break;
                }
                throw e;
            }
        }
        this.ppu.paintFrame();
        if (error || this.print) {
            this.displayMem();
            this.displayPPUMem();
            $("#debugDisplay").show();
            this.print = false;
        }
        else {
            this.lastAnimFrame = window.requestAnimationFrame(this.step.bind(this));
        }
    }
    printDebug() {
        this.print = true;
    }
    read(addr) {
        if (addr >= 0x2000 && addr <= 0x3FFF) {
            let res = this.ppu.readReg(0x2000 + (addr % 8));
            if (res !== undefined)
                return res;
        }
        else if (addr == 0x4016 || addr == 0x4017) {
            return this.input.read(addr);
        }
        else if (addr == 0x4015) {
            return this.apu.read4015();
        }
        return this.mainMemory[addr];
    }
    //Skip setting register values when reading
    readNoReg(addr) {
        return this.mainMemory[addr];
    }
    write(addr, data) {
        if (addr < 0x2000) {
            //RAM mirroring
            for (let i = 0; i < 0x2000; i += 0x800) {
                this.mainMemory[i + (addr % 0x800)] = data;
            }
        }
        else if (addr >= 0x2000 && addr <= 0x3FFF) {
            //PPU register mirroring
            for (let i = 0x2000; i < 0x3FFF; i += 8) {
                this.mainMemory[i + (addr % 8)] = data;
            }
            this.ppu.writeReg(0x2000 + (addr % 8), data);
        }
        else if (addr >= 0x4000 && addr <= 0x4013) {
            //APU registers
            this.apu.notifyWrite(addr, data);
        }
        else if (addr == 0x4014) {
            //OAM DMA
            this.ppu.writeReg(addr, data);
        }
        else if (addr == 0x4015) {
            //APU Status
            this.apu.notifyWrite(addr, data);
        }
        else if (addr == 0x4016) {
            //Input register
            this.input.setStrobe((data & 1) != 0);
        }
        else if (addr == 0x4017) {
            //APU Frame Counter
            this.apu.notifyWrite(addr, data);
        }
        else if (addr >= 0x4020) {
            //Notify mapper of potential register writes. Don't write value
            //if function returns false.
            if (!this.rom.mapper.notifyWrite(addr, data))
                return;
        }
        this.mainMemory[addr] = data;
    }
    //Skip setting register values when writing
    writeNoReg(addr, data) {
        if (addr >= 0x2000 && addr <= 0x3FFF) {
            for (let i = 0x2000; i < 0x3FFF; i += 8) {
                this.mainMemory[i + (addr % 8)] = data;
            }
        }
    }
    displayMem() {
        let str = "";
        for (let i = 0; i < this.mainMemory.length; i++) {
            str += this.mainMemory[i].toString(16).padStart(2, "0").toUpperCase();
        }
        $("#mem").html(str);
    }
    displayPPUMem() {
        let str = "";
        for (let i = 0; i < this.ppu.mem.length; i++) {
            str += this.ppu.mem[i].toString(16).padStart(2, "0").toUpperCase();
        }
        $("#ppuMem").html(str);
    }
    displayOAMMem() {
        let str = "";
        for (let i = 0; i < this.ppu.oam.length; i++) {
            str += this.ppu.oam[i].toString(16).padStart(2, "0").toUpperCase();
        }
        $("#ppuMem").html(str);
    }
}
//Initialize NES
let nes;
let input = new Input();
window.onbeforeunload = function () {
    if (nes !== undefined) {
        saveRAM();
        nes.storeState();
    }
    sessionStorage.setItem("volume", $("#volume").val().toString());
    sessionStorage.setItem("scale", PPU.scale.toString());
    localStorage.setItem("saveWarn", (NES.saveWarn) ? "1" : "0");
};
var noiseGain;
$(document).ready(function () {
    if (!checkComp())
        return;
    //Check little/big endianness of Uint32
    let buff = new ArrayBuffer(8);
    let view32 = new Uint32Array(buff);
    view32[1] = 0x0A0B0C0D;
    PPU.isLittleEndian = true;
    if (buff[4] === 0x0A && buff[5] === 0x0B && buff[6] === 0x0C && buff[7] === 0x0D) {
        PPU.isLittleEndian = false;
    }
    //Set the save state warning indicator
    NES.saveWarn = (localStorage.getItem("saveWarn") == "0") ? false : true;
    $("#warningFlag").prop("checked", NES.saveWarn);
    //Set up APU/Web Audio API
    let a = new AudioContext();
    APU.masterGain = a.createGain();
    APU.masterGain.connect(a.destination);
    let osc = a.createOscillator();
    osc.type = "triangle";
    let g = a.createGain();
    osc.connect(g);
    g.connect(APU.masterGain);
    APU.triangle = new TriangleChannel(osc, g);
    osc = a.createOscillator();
    osc.type = "square";
    g = a.createGain();
    osc.connect(g);
    g.connect(APU.masterGain);
    APU.pulse1 = new PulseChannel(osc, g);
    osc = a.createOscillator();
    osc.type = "square";
    g = a.createGain();
    osc.connect(g);
    g.connect(APU.masterGain);
    APU.pulse2 = new PulseChannel(osc, g, false);
    let o = a.createNoiseSource();
    g = a.createGain();
    o.connect(g);
    g.connect(APU.masterGain);
    APU.noise = new NoiseChannel(o, g);
    //Check for existing volume settings
    if (sessionStorage.getItem("volume") === null) {
        updateVol(0.25); //Set initial volume to 25% (50% of the UI's max)
    }
    else {
        let vol = parseFloat(sessionStorage.getItem("volume"));
        $("#volume").val(vol);
        updateVol(vol);
    }
    //Create canvas
    PPU.canvas = $("#screen")[0];
    //Check for existing scale settings
    if (sessionStorage.getItem("scale") == null) {
        PPU.updateScale(2);
    }
    else {
        let scale = parseInt(sessionStorage.getItem("scale"));
        PPU.updateScale(scale);
        $("#scale").val(PPU.scale);
    }
    $("#scale").change(function () {
        PPU.updateScale(parseInt($("#scale")[0].value));
    });
    $("#reset-btn").on("click", function () {
        if (nes !== undefined)
            nes.reset();
        this.blur();
    });
    //Mute audio when webpage is hidden
    $(document).on('visibilitychange', function () {
        if (document.hidden) {
            APU.masterGain.gain.setTargetAtTime(0, 0, 0.05);
        }
        else {
            APU.masterGain.gain.setTargetAtTime(APU.masterVol, 0, 0.5);
        }
    });
    //Set up relevant button listeners
    $(document).on("keydown", function (e) {
        if (input.setBtn(e.keyCode, true)) {
            e.preventDefault();
        }
    });
    $(document).on("keyup", function (e) {
        if (input.setBtn(e.keyCode, false)) {
            e.preventDefault();
        }
    });
    //Build the button mapping control table
    input.buildControlTable($("#p1Controls"));
    input.buildControlTable($("#p2Controls"), false);
    //Set up event listener for file picker to launch ROM
    $('#file-input').change(function (e) {
        init(e.target.files[0]);
    });
});
//Save any battery-backed RAM
function saveRAM() {
    if (!nes.rom.batteryBacked)
        return;
    localStorage.setItem(nes.rom.id, nes.mainMemory.slice(0x6000, 0x8000).toString());
}
function fileDropHandler(e) {
    e.preventDefault();
    init(e.dataTransfer.files[0]);
}
function init(file) {
    if (!file) {
        return;
    }
    if (nes !== undefined) {
        window.cancelAnimationFrame(nes.lastAnimFrame);
        saveRAM();
        nes.storeState();
    }
    else {
        //Start the oscillators after the user chooses a file
        //Complies with Chrome's upcoming Web Audio API autostart policy
        APU.noise.osc.start(0);
        APU.triangle.osc.start(0);
        APU.pulse1.osc.start(0);
        APU.pulse2.osc.start(0);
    }
    let reader = new FileReader();
    reader.onload = function (e) {
        nes = new NES(new Uint8Array(e.target.result), input);
        nes.boot();
    };
    reader.readAsArrayBuffer(file);
}
