class PPU {
    public mem: Uint8Array;
    private OAM: Uint8Array;
    private cpuMem: Uint8Array;
    private oddFrame: boolean;

    private readonly PPUCTRL: number = 0x2000;
    private readonly PPUMASK: number = 0x2001;
    private readonly PPUSTATUS: number = 0x2002;
    private readonly OAMADDR: number = 0x2003;
    private readonly OAMDATA: number = 0x2004;
    private readonly PPUSCROLL: number = 0x2005;
    private readonly PPUADDR: number = 0x2006;
    private readonly PPUDATA: number = 0x2007;
    private readonly OAMDMA: number = 0x4014;


    constructor(mainMemory: Uint8Array) {
        this.mem = new Uint8Array(0x4000);
        this.OAM = new Uint8Array(0x100);
        this.cpuMem = mainMemory
    }

    public boot() {
        this.cpuMem[this.PPUCTRL] = 0;
        this.cpuMem[this.PPUMASK] = 0;
        this.cpuMem[this.PPUSTATUS] = 0xA0;
        this.cpuMem[this.OAMADDR] = 0;
        this.cpuMem[this.PPUSCROLL] = 0;
        this.cpuMem[this.PPUADDR] = 0;
        this.cpuMem[this.PPUDATA] = 0;
        this.oddFrame = false;
    }

    public reset() {
        this.cpuMem[this.PPUCTRL] = 0;
        this.cpuMem[this.PPUMASK] = 0;
        this.cpuMem[this.PPUSCROLL] = 0;
        this.cpuMem[this.PPUDATA] = 0;
        this.oddFrame = false;
    }
}
