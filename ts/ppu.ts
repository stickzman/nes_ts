class PPU {
    public mem: Uint8Array;
    private OAM: Uint8Array;
    private regData: Uint8Array;
    private oamdmaData: Uint8Array;
    private oddFrame: boolean;

    constructor(mainMemory: Uint8Array) {
        this.mem = new Uint8Array(0x4000);
        this.OAM = new Uint8Array(0x100);
        this.regData = mainMemory.slice(0x2000, 0x2008);
        this.oamdmaData = mainMemory.slice(0x4014, 0x4015);
    }

    public boot() {
        this.regData[0] = 0;
        this.regData[1] = 0;
        this.regData[2] |= 64;
        this.regData[2] &= 95;
        this.regData[3] = 0;
        this.regData[5] = 0;
        this.regData[6] = 0;
        this.regData[7] = 0;
        this.oddFrame = false;
    }

    public reset() {
        this.regData[0] = 0;
        this.regData[1] = 0;
        this.regData[5] = 0;
        this.regData[7] = 0;
        this.oddFrame = false;
    }
}
