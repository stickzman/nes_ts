class PPU {
    public mem: Uint8Array;
    private OAM: Uint8Array;
    private cpuMem: Uint8Array;
    private oddFrame: boolean;

    constructor(mainMemory: Uint8Array) {
        this.mem = new Uint8Array(0x4000);
        this.OAM = new Uint8Array(0x100);
        this.cpuMem = mainMemory
    }

    public boot() {
        this.cpuMem[0x2000] = 0;
        this.cpuMem[0x2001] = 0;
        this.cpuMem[0x2002] |= 64;
        this.cpuMem[0x2002] &= 95;
        this.cpuMem[0x2003] = 0;
        this.cpuMem[0x2005] = 0;
        this.cpuMem[0x2006] = 0;
        this.cpuMem[0x2007] = 0;
        this.oddFrame = false;
    }

    public reset() {
        this.cpuMem[0x2000] = 0;
        this.cpuMem[0x2001] = 0;
        this.cpuMem[0x2005] = 0;
        this.cpuMem[0x2007] = 0;
        this.oddFrame = false;
    }
}
