class APU {
    private cycle: number = 0;
    private irqEnable: boolean = true;
    private is4Step: boolean = true;
    private pulse1Enable: boolean = false;
    private pulse2Enable: boolean = false;
    private triangleEnable: boolean = false;
    private noiseEnable: boolean = false;
    private dmcEnable: boolean = false;

    private nes: NES;

    constructor(nes: NES) {
        this.nes = nes;
    }

    public reset() {
        this.pulse1Enable = false;
        this.pulse2Enable = false;
        this.triangleEnable = false;
        this.noiseEnable = false;
        this.dmcEnable = false;
    }

    public notifyWrite(addr: number, data: number) {
        if (addr == 0x4017) {
            //Frame Counter
            this.is4Step = (data & 0x80) == 0;
            this.irqEnable = (data & 0x40) == 0;
        } else if (addr == 0x4015) {
            this.pulse1Enable = (data & 1) != 0;
            this.pulse2Enable = (data & 2) != 0;
            this.triangleEnable = (data & 4) != 0;
            this.noiseEnable = (data & 8) != 0;
            this.dmcEnable = (data & 16) != 0;
        }
    }

    public step() {
        this.cycle++;
        if (this.is4Step) {
            if (this.cycle == 14915) {
                this.cycle = 0;
            } else if (this.cycle == 14914) {
                if (this.irqEnable) {
                    this.nes.cpu.requestInterrupt();
                }
                this.clockQuarter();
                this.clockHalf();
            } else if (this.cycle == 7456) {
                this.clockQuarter();
                this.clockHalf();
            } else if (this.cycle == 11185 || this.cycle == 3728) {
                this.clockQuarter();
            }
        } else {
            if (this.cycle == 18641) {
                this.cycle = 0;
            } else if (this.cycle == 18640 || this.cycle == 7456) {
                this.clockQuarter();
                this.clockHalf();
            } else if (this.cycle == 11185 || this.cycle == 3728) {
                this.clockHalf();
            }
        }
    }

    private clockHalf() {

    }

    private clockQuarter() {

    }
}
