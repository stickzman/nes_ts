class PPU {
    public mem: Uint8Array;
    private OAM: Uint8Array;
    private cpuMem: Uint8Array;

    private oddFrame: boolean = false;
    private latch = false;
    private vRamAddr: number;
    private scanline: number = 0;
    private dot: number = 0;

    //CTRL vars
    private static baseNTAddr: number = 0x2000;
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
    //STATUS vars
    private vbl: boolean = false;

    private readonly PPUCTRL: number = 0x2000;
    private readonly PPUMASK: number = 0x2001;
    private readonly PPUSTATUS: number = 0x2002;
    private readonly OAMADDR: number = 0x2003;
    private readonly OAMDATA: number = 0x2004;
    private readonly PPUSCROLL: number = 0x2005;
    private readonly PPUADDR: number = 0x2006;
    private readonly PPUDATA: number = 0x2007;
    private readonly OAMDMA: number = 0x4014;

    //Render vars
    private ntPointer = {
        row: 0, //0-29 (30 rows, each row 8 px height)
        col: 0, //0-31 (32 cols, each column 8 px width)
        addr: function () {
            //return ((this.row * 16) << 1) + this.col + PPU.baseNTAddr;
            return this.row * 32 + this.col + PPU.baseNTAddr;
        },
        incCol: function() {
            if (++this.col > 31) {
                this.col = 0;
            }
        },
        incRow: function() {
            if (++this.row > 29) {
                this.row = 0;
            }
        }
    }
    private atPointer = {
        row: 0, //0-7.5 (8 rows, each row 32 px height)
        col: 0, //0-8 (8 cols, each column 32 px width)
        addr: function () {
            return this.row * 8 + 0xC0 + this.col + PPU.baseNTAddr;
        },
        incCol: function() {
            if (++this.col > 7) {
                this.col = 0;
            }
        },
        incRow: function() {
            if (++this.row > 6.5) {
                this.row = 0;
            }
        }
    }


    constructor(mainMemory: Uint8Array, private ctx: CanvasRenderingContext2D) {
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

    public cycle() {
        switch (true) {
            case (this.scanline < 240):
                if (this.oddFrame && this.dot == 0 && this.scanline == 0) this.dot++;
                this.visibleCycle();
                break;
            case (this.scanline < 260):
                //POST-RENDER
                break;
            case (this.scanline == 261):
                //PRE-RENDER
                break;
        }
        if (++this.dot > 340) {
            this.dot = 0;
            if (++this.scanline > 261) {
                this.scanline = 0;
                this.oddFrame = !this.oddFrame;
            }
        }
    }

    public visibleCycle() {
        if (this.dot <= 256) {
            console.log(this.ntPointer.addr().toString(16), this.atPointer.addr().toString(16));

            //Inc Nametable Pointer
            if (this.dot % 8 == 0 && this.dot != 0) {
                this.ntPointer.incCol();
                if (this.ntPointer.col == 0
                        && this.scanline % 8 == 7) {
                    this.ntPointer.incRow();
                }
            }
            //Inc Attr Table Pointer
            if (this.dot % 32 == 0 && this.dot != 0) {
                this.atPointer.incCol();
                if (this.scanline % 32 == 31) {
                    this.atPointer.incRow();
                }
            }
            //Reset pointers
            if (this.dot == 0 && this.scanline == 261) {
                this.atPointer.row = 0;
                this.atPointer.col = 0;
                this.ntPointer.row = 0;
                this.ntPointer.col = 0;
            }
        }
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
                    case 0: PPU.baseNTAddr = 0x2000; break;
                    case 1: PPU.baseNTAddr = 0x2400; break;
                    case 2: PPU.baseNTAddr = 0x2800; break;
                    case 3: PPU.baseNTAddr = 0x2C00; break;
                }
                this.incAddrBy32 = (byte & 4) != 0;
                if ((byte & 8) != 0) {
                    this.spritePatAddr = 0x1000;
                } else {
                    this.spritePatAddr = 0;
                }
                if ((byte & 16) != 0) {
                    this.bkgPatAddr = 0x1000;
                } else {
                    this.bkgPatAddr = 0;
                }
                this.sprite8x16 = (byte & 32) != 0;
                this.masterSlave = (byte & 64) != 0;
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
                if (!this.latch) {
                    this.vRamAddr = byte << 8;
                } else {
                    this.vRamAddr += byte;
                }
                this.latch = !this.latch;
                break;
            case this.PPUDATA:
                this.mem[this.vRamAddr] = byte;
                if (this.incAddrBy32) {
                    this.vRamAddr += 32;
                } else {
                    this.vRamAddr += 1;
                }
                break;
        }
    }

    private setVBL() {
        this.vbl = true;
        this.mem[this.PPUSTATUS] |= 128;
    }

    private clearVBL() {
        this.vbl = false;
        this.mem[this.PPUSTATUS] &= 0x7F;
    }
}
