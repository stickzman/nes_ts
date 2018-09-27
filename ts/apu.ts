class APU {
    private cycles: number = 0;
    private is4Step: boolean;
    private irqEnabled: boolean;

    private nes: NES;
    private audio: AudioContext;
    private triangle: AudioChannel;

    constructor(nes: NES) {
        this.nes = nes;
        this.is4Step = true;
        this.irqEnabled = true;
    }

    public reset() {

    }

    public read4015(): number {
        let byte = 0;
        byte |= (this.nes.cpu.apuIRQ) ? 0x40 : 0;
        this.nes.cpu.apuIRQ = false; //Acknowledge IRQ
        return byte;
    }

    public notifyWrite(addr: number, data: number) {
        if (addr == 0x4017) {
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
            if (this.cycles == 14914) {
                if (this.irqEnabled) {
                    this.nes.cpu.apuIRQ = true;
                }
            } else if (this.cycles == 14914.5) {
                this.clockQuarter();
                this.clockHalf();
            } else if (this.cycles == 14915) {
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
    }

    private clockQuarter() {

    }

    private clockHalf() {
        
    }
}
