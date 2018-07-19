class PPU {
    public mem: Uint8Array;
    private OAM: Uint8Array;
    private cpuMem: Uint8Array;

    private oddFrame: boolean = false;
    private latch = false;
    private address: number;
    private scanline: number;

    //CTRL vars
    private baseNTAddr: number = 0x2000;
    private incAddrBy32: boolean = false; //If false, inc by 1
    private spritePatAddr: number = 0;
    private bkgPatAddr: number = 0;
    private sprite8x16: boolean = false; //If false, sprite size is 8x8
    private masterSlave: boolean = false;
    private vBlankNMI: boolean = false;
    //MASK vars
    private greyscale: boolean = false;
    private showLeftBkg: boolean = false;
    private showLeftSprite: boolean = false;
    private showBkg: boolean = false;
    private showSprites: boolean = false;
    private maxRed: boolean = false;
    private maxGreen: boolean = false;
    private maxBlue: boolean = false;

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
        this.cpuMem = mainMemory;
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

    public readReg(addr: number) {
        switch (addr) {
            case this.PPUSTATUS:
                this.latch = false;
                //this.cpuMem[addr] = (this.cpuMem[addr] & 0x7F);
                break;
        }
    }

    public writeReg(addr: number) {
        let byte = this.cpuMem[addr];
        switch (addr) {
            case this.PPUCTRL:
                let ntBit = byte & 3;
                switch (ntBit) {
                    case 0: this.baseNTAddr = 0x2000; break;
                    case 1: this.baseNTAddr = 0x2400; break;
                    case 2: this.baseNTAddr = 0x2800; break;
                    case 3: this.baseNTAddr = 0x2C00; break;
                }
                this.incAddrBy32 = (byte & 4) == 1;
                if ((byte & 8) == 1) {
                    this.spritePatAddr = 0x1000;
                } else {
                    this.spritePatAddr = 0;
                }
                if ((byte & 16) == 1) {
                    this.bkgPatAddr = 0x1000;
                } else {
                    this.bkgPatAddr = 0;
                }
                this.sprite8x16 = (byte & 32) == 1;
                this.masterSlave = (byte & 64) == 1;
                this.vBlankNMI = (byte & 128) == 1;
                break;
            case this.PPUMASK:
                this.greyscale = (byte & 1) == 1;
                this.showLeftBkg = (byte & 2) == 1;
                this.showLeftSprite = (byte & 4) == 1;
                this.showBkg = (byte & 8) == 1;
                this.showSprites = (byte & 16) == 1;
                this.maxRed = (byte & 32) == 1;
                this.maxGreen = (byte & 64) == 1;
                this.maxBlue = (byte & 128) == 1;
                break;
            case this.PPUADDR:
                console.log("Address Set");
                if (!this.latch) {
                    this.address = byte << 8;
                } else {
                    this.address += byte;
                }
                this.latch = !this.latch;
                break;
            case this.PPUDATA:
                console.log(byte.toString(16).toUpperCase() + " at " + this.address.toString(16).toUpperCase());
                this.mem[this.address] = byte;
                if (this.incAddrBy32) {
                    this.address += 32;
                } else {
                    this.address += 1;
                }
                break;
        }
    }
}
